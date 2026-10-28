// Runs with the collector started continuously, so that marking threads read cells while this thread creates, grows and converts them.
// Every round creates one holder of each kind around the round's number, keeps it in a ring that has long been promoted, and reads back a holder of an earlier round.
// On a CPU that reorders stores, a cell that is published before its initialization is visible reaches the marker half written.
const rounds = Number(process.env.ROUNDS ?? 30000);
const ringSize = 257;

class Leaf {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
}

class Fields {
  count: number;
  ratio: number;
  name: string;
  leaf: Leaf;
  other: Leaf | null = null;
  late?: Leaf;
  later?: number;
  constructor(id: number) {
    this.count = id;
    this.ratio = id + 0.5;
    this.name = "n" + id;
    this.leaf = new Leaf(id);
  }
}

class Base {
  leaf: Leaf;
  constructor(id: number) {
    this.leaf = new Leaf(id);
  }
  read() {
    return this.leaf.id;
  }
}

class Derived extends Base {
  second: Leaf;
  constructor(id: number) {
    super(id);
    this.second = new Leaf(id);
  }
  override read() {
    return same(super.read(), this.second.id);
  }
}

function same(...ids: number[]): number {
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] !== ids[0]) return -1;
  }
  return ids.length ? ids[0] : -1;
}

function* countUp(id: number): Generator<Leaf, Leaf, number> {
  const first = new Leaf(id);
  const sent = yield first;
  const second = new Leaf(sent);
  const again = yield second;
  return new Leaf(same(first.id, second.id, again));
}

async function awaitTwice(id: number): Promise<number> {
  const before = new Leaf(id);
  const value = await Promise.resolve(new Leaf(id));
  const middle = [before, value];
  const next = await new Leaf(id);
  return same(before.id, value.id, middle[0].id, middle[1].id, next.id);
}

type Kind = { name: string; create: (id: number) => unknown; read: (holder: any) => number };

const kinds: Kind[] = [
  { name: "typed object", create: id => new Fields(id), read: (h: Fields) => same(h.count, h.ratio - 0.5, Number(h.name.slice(1)), h.leaf.id) },
  {
    name: "typed object whose optional fields are stored later",
    create: id => {
      const fields = new Fields(id);
      fields.other = new Leaf(id);
      fields.late = new Leaf(id);
      fields.later = id;
      return fields;
    },
    read: (h: Fields) => same(h.leaf.id, h.other!.id, h.late!.id, h.later!),
  },
  {
    name: "typed object with properties nobody declared",
    create: id => {
      const fields: any = new Fields(id);
      fields.extra = new Leaf(id);
      fields["more" + (id & 3)] = new Leaf(id);
      return fields;
    },
    read: h => same(h.leaf.id, h.extra.id, h["more" + (h.count & 3)].id),
  },
  { name: "derived class", create: id => new Derived(id), read: (h: Derived) => h.read() },
  { name: "object literal", create: id => ({ a: new Leaf(id), b: id, c: { d: new Leaf(id) } }), read: h => same(h.a.id, h.b, h.c.d.id) },
  {
    name: "object that grows out of line",
    create: id => {
      const object: Record<string, Leaf> = {};
      for (let i = 0; i < 12; i++) object["p" + i] = new Leaf(id);
      return object;
    },
    read: h => same(h.p0.id, h.p5.id, h.p6.id, h.p11.id),
  },
  { name: "array literal of objects", create: id => [new Leaf(id), new Leaf(id), new Leaf(id), new Leaf(id), new Leaf(id), new Leaf(id)], read: (h: Leaf[]) => same(h[0].id, h[3].id, h[5].id, h.length + h[1].id - 6) },
  { name: "array literal of integers", create: id => [id, id, id], read: (h: number[]) => same(h[0], h[1], h[2]) },
  { name: "array literal of doubles", create: id => [id + 0.25, id + 0.25], read: (h: number[]) => same(h[0] - 0.25, h[1] - 0.25) },
  {
    name: "array that grows by push",
    create: id => {
      const array: Leaf[] = [];
      for (let i = 0; i < 20; i++) array.push(new Leaf(id));
      return array;
    },
    read: (h: Leaf[]) => same(h[0].id, h[7].id, h[19].id),
  },
  {
    name: "array of holes that is filled",
    create: id => {
      const array = new Array<Leaf>(9);
      for (let i = 8; i >= 0; i--) array[i] = new Leaf(id);
      return array;
    },
    read: (h: Leaf[]) => same(h[0].id, h[8].id),
  },
  {
    name: "slice, concat and spread",
    create: id => {
      const source = [new Leaf(id), new Leaf(id), new Leaf(id), new Leaf(id)];
      return [source.slice(1, 3), source.concat(source), [...source, new Leaf(id)], source.slice()];
    },
    read: (h: Leaf[][]) => same(h[0][1].id, h[1][7].id, h[2][4].id, h[3][0].id),
  },
  {
    name: "closure over variables",
    create: id => {
      let current = new Leaf(id);
      let count = id;
      return { get: () => same(current.id, count), set: (leaf: Leaf) => { current = leaf; count = leaf.id; } };
    },
    read: h => {
      const before = h.get();
      h.set(new Leaf(before));
      return same(before, h.get());
    },
  },
  {
    name: "closure that becomes an object with properties",
    create: id => {
      const leaf = new Leaf(id);
      const closure: any = () => leaf.id;
      closure.own = new Leaf(id);
      return closure;
    },
    read: h => same(h(), h.own.id),
  },
  {
    name: "function used as a constructor",
    create: id => {
      const Made: any = function (this: any) { this.leaf = new Leaf(id); };
      Made.prototype.read = function () { return this.leaf.id; };
      return new Made();
    },
    read: h => h.read(),
  },
  { name: "bound function", create: id => function (this: Leaf, other: Leaf) { return same(this.id, other.id); }.bind(new Leaf(id), new Leaf(id)), read: h => h() },
  {
    name: "map and set",
    create: id => {
      const map = new Map<unknown, Leaf>();
      const set = new Set<Leaf>();
      for (let i = 0; i < 10; i++) {
        map.set(i & 1 ? "k" + i : i, new Leaf(id));
        set.add(new Leaf(id));
      }
      return { map, set };
    },
    read: h => {
      let last = -1;
      for (const leaf of h.set) last = leaf.id;
      return same(h.map.get(0).id, h.map.get("k9").id, last, h.map.size + h.set.size + last - 20);
    },
  },
  { name: "weak map", create: id => { const key = new Leaf(id); const map = new WeakMap<Leaf, Leaf>(); map.set(key, new Leaf(id)); return { key, map }; }, read: h => same(h.key.id, h.map.get(h.key).id) },
  { name: "rope and substring", create: id => { const rope = "left-" + id + "-" + id + "-right"; return [rope, rope.substring(5, 5 + String(id).length)]; }, read: (h: string[]) => same(Number(h[0].split("-")[2]), Number(h[1])) },
  { name: "typed array", create: id => { const bytes = new Uint32Array(5); bytes.fill(id); return bytes; }, read: (h: Uint32Array) => same(h[0], h[4]) },
  { name: "regular expression", create: id => ({ pattern: /(\d+)-(\d+)/, text: id + "-" + id }), read: h => { const match = h.pattern.exec(h.text); return same(Number(match[1]), Number(match[2])); } },
  { name: "big integer", create: id => BigInt(id) * 4294967296n * 4294967296n, read: (h: bigint) => Number(h / 4294967296n / 4294967296n) },
  {
    name: "suspended generator",
    create: id => {
      const generator = countUp(id);
      return { generator, first: generator.next().value };
    },
    read: h => {
      const id = h.first.id;
      return same(id, h.generator.next(id).value.id, h.generator.next(id).value.id);
    },
  },
  { name: "error with a stack", create: id => { const error: any = new RangeError("r" + id); error.leaf = new Leaf(id); return error; }, read: h => same(Number(h.message.slice(1)), h.leaf.id) },
  { name: "arguments and rest", create: id => (function (...rest: Leaf[]) { return { rest, all: arguments }; })(new Leaf(id), new Leaf(id), new Leaf(id)), read: h => same(h.rest[2].id, h.all[0].id, h.all.length + h.rest[1].id - 3) },
  { name: "copied object", create: id => { const source = new Fields(id); return [{ ...source }, Object.assign({}, source), structuredClone({ id })]; }, read: h => same(h[0].leaf.id, h[1].count, h[2].id) },
  { name: "parsed data", create: id => JSON.parse('{"a":{"id":' + id + '},"b":[' + id + "," + id + "]}"), read: h => same(h.a.id, h.b[0], h.b[1]) },
];

const ring: unknown[][] = kinds.map(() => new Array(ringSize).fill(null));
let checksum = 0;
let pending = 0;

function fail(kind: Kind, expected: number, actual: number): never {
  console.log(`${kind.name}: the holder of round ${expected} reads ${actual}`);
  process.exit(1);
}

function runRound(round: number) {
  const slot = round % ringSize;
  for (let k = 0; k < kinds.length; k++) {
    const kind = kinds[k];
    const old = ring[k][slot];
    if (old !== null) {
      const actual = kind.read(old);
      if (actual !== round - ringSize) fail(kind, round - ringSize, actual);
      checksum = (checksum + actual) % 1000003;
    }
    ring[k][slot] = kind.create(round);
  }
}

const asyncKind: Kind = { name: "async function", create: () => null, read: () => -1 };
for (let round = 1; round <= rounds; round++) {
  runRound(round);
  pending++;
  awaitTwice(round).then(actual => {
    if (actual !== round) fail(asyncKind, round, actual);
    pending--;
  });
  if (!(round & 63)) await null;
}
while (pending) await null;
console.log("ok", rounds, checksum);

export {};
