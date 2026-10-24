// Each case is the only path from a root to its leaves, through one cell class that the collector's marking loop visits without the method table, or through one that the loop must send to the method table. The allocations after a collection reuse the cell of a leaf that was not marked.
const shell = globalThis as any;
const collectFull: () => void = shell.gc ?? (() => Bun.gc(true));
const collectYoung: () => void = shell.edenGC ?? require("bun:jsc").edenGC;
const youngCollectionCount = 50;

class Leaf {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
}

type Case = {
  name: string;
  build: (id: number) => unknown;
  read: (holder: any) => number | Promise<number>;
  replace?: (holder: any, id: number) => void;
};

const same = (...ids: number[]) => (ids.length > 0 && ids.every(id => id === ids[0]) ? ids[0] : -1);

function withLeaf(object: any, id: number) {
  object.leaf = new Leaf(id);
  return object;
}

class Fields {
  boxed: unknown = null;
  narrow: Leaf | null = null;
}

const wideFieldCount = 40;
class Wide {
  f0?: Leaf; f1?: Leaf; f2?: Leaf; f3?: Leaf; f4?: Leaf; f5?: Leaf; f6?: Leaf; f7?: Leaf; f8?: Leaf; f9?: Leaf;
  f10?: Leaf; f11?: Leaf; f12?: Leaf; f13?: Leaf; f14?: Leaf; f15?: Leaf; f16?: Leaf; f17?: Leaf; f18?: Leaf; f19?: Leaf;
  f20?: Leaf; f21?: Leaf; f22?: Leaf; f23?: Leaf; f24?: Leaf; f25?: Leaf; f26?: Leaf; f27?: Leaf; f28?: Leaf; f29?: Leaf;
  f30?: Leaf; f31?: Leaf; f32?: Leaf; f33?: Leaf; f34?: Leaf; f35?: Leaf; f36?: Leaf; f37?: Leaf; f38?: Leaf; f39?: Leaf;
}

function fillWide(wide: Wide, id: number) {
  const untyped: any = wide;
  for (let i = 0; i < wideFieldCount; i++) untyped["f" + i] = new Leaf(id);
  wide.f0 = new Leaf(id);
  wide.f39 = new Leaf(id);
  return wide;
}

function readWide(wide: Wide) {
  const untyped: any = wide;
  const ids = [wide.f0!.id, wide.f39!.id];
  for (let i = 0; i < wideFieldCount; i++) ids.push(untyped["f" + i].id);
  return same(...ids);
}

function createVariable(leaf: Leaf) {
  let current = leaf;
  return {
    get: () => current,
    set: (next: Leaf) => {
      current = next;
    },
  };
}

const capture = (leaf: Leaf) => () => leaf;

function createConstructor(leaf: Leaf) {
  return function (this: any) {
    this.leaf = leaf;
  };
}

function createClass(leaf: Leaf) {
  return class {
    static leaf = leaf;
  };
}

function* suspend(leaf: Leaf) {
  yield 0;
  yield leaf.id;
}

function getThisID(this: Leaf) {
  return this.id;
}

function getArgumentsID(first: Leaf, second: Leaf) {
  return same(first.id, second.id);
}

// As a JSValue these bits are a cell pointer, so a visit that takes an array of doubles for an array of values crashes.
const cellLikeDouble = new Float64Array(new BigUint64Array([0x7ffffffe0000n]).buffer)[0];

const createLiterals = () => ({ strings: ["left", "right"], integers: [1, 2, 3], doubles: [1.5, 2.5] });

const sparseIndex = 5000000;

const side = (fill: string, id: number) => fill.repeat(40) + id;
const createRope = (id: number) => side("l", id) + side("r", id);
const createLongRope = (id: number) => `${side("a", id)}${side("b", id)}${side("c", id)}`;
const createSubstring = (id: number) => createRope(id).substring(30, 60);

function fillObject(object: any, count: number, id: number) {
  for (let i = 0; i < count; i++) object["p" + i] = new Leaf(id);
  return object;
}

const objectCase = (name: string, create: () => any, count: number): Case => ({
  name: `${name} with ${count} properties`,
  build: id => fillObject(create(), count, id),
  read: object => {
    const keys = Object.keys(object);
    return keys.length === count ? same(...keys.map(key => object[key].id)) : -1;
  },
  replace: (object, id) => {
    fillObject(object, count, id);
  },
});

function fillMap(map: Map<string, Leaf>, count: number, id: number) {
  for (let i = 0; i < count; i++) map.set("key" + i, new Leaf(id));
  return map;
}

const mapCase = (count: number): Case => ({
  name: `Map with ${count} string keys`,
  build: id => fillMap(new Map<string, Leaf>(), count, id),
  read: (map: Map<string, Leaf>) =>
    map.size === count ? same(map.get("key0")!.id, map.get("key" + (count - 1))!.id, ...[...map.values()].map(leaf => leaf.id)) : -1,
  replace: (map: Map<string, Leaf>, id) => {
    fillMap(map, count, id);
  },
});

function fillSet(set: Set<string>, count: number, id: number) {
  for (let i = 0; i < count; i++) set.add("key" + id + "_" + i);
  return set;
}

const setCase = (count: number): Case => ({
  name: `Set with ${count} strings`,
  build: id => fillSet(new Set<string>(), count, id),
  read: (set: Set<string>) => (set.size === count ? same(...[...set].map(key => Number(key.slice(3, 7)))) : -1),
  replace: (set: Set<string>, id) => {
    set.clear();
    fillSet(set, count, id);
  },
});

const createColors = () => new Set(["red", "green", "blue"]);
const createNumerals = () => new Map([["one", 1], ["two", 2], ["three", 3]]);

function createPending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolveFunction => {
    resolve = resolveFunction;
  });
  return { promise, resolve };
}

const reactionCase = (name: string, count: number): Case => ({
  name: `pending promise with ${name}`,
  build: id => {
    const { promise, resolve } = createPending<void>();
    const results: Promise<number>[] = [];
    for (let i = 0; i < count; i++) {
      const leaf = new Leaf(id);
      results.push(i % 2 ? promise.then(() => leaf.id, () => -1) : promise.then(() => leaf.id));
    }
    return { resolve, results };
  },
  read: async ({ resolve, results }: { resolve: () => void; results: Promise<number>[] }) => {
    resolve();
    return same(...(await Promise.all(results)));
  },
});

async function readAfter(promise: Promise<void>, leaf: Leaf) {
  await promise;
  return leaf.id;
}

class Tagged<T> extends Promise<T> {
  tag: Leaf | undefined;
}

// (type $s (struct (field externref))) (func (export "new") (param externref) (result (ref $s)) local.get 0 struct.new $s) (func (export "get") (param (ref null $s)) (result externref) local.get 0 struct.get $s 0)
const structModule = new WebAssembly.Module(
  new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x11, 0x03, 0x5f, 0x01, 0x6f, 0x00, 0x60, 0x01, 0x6f, 0x01, 0x64, 0x00, 0x60, 0x01, 0x63, 0x00, 0x01, 0x6f,
    0x03, 0x03, 0x02, 0x01, 0x02,
    0x07, 0x0d, 0x02, 0x03, 0x6e, 0x65, 0x77, 0x00, 0x00, 0x03, 0x67, 0x65, 0x74, 0x00, 0x01,
    0x0a, 0x12, 0x02, 0x07, 0x00, 0x20, 0x00, 0xfb, 0x00, 0x00, 0x0b, 0x08, 0x00, 0x20, 0x00, 0xfb, 0x02, 0x00, 0x00, 0x0b,
  ]),
);
const structExports = new WebAssembly.Instance(structModule, {}).exports;
const createStruct = structExports.new as (value: unknown) => object;
const readStruct = structExports.get as (struct: object) => Leaf;

const cases: Case[] = [
  {
    name: "class instance, field of unknown type",
    build: id => {
      const fields = new Fields();
      fields.boxed = new Leaf(id);
      return fields;
    },
    read: (fields: Fields) => (fields.boxed as Leaf).id,
    replace: (fields: Fields, id) => {
      fields.boxed = new Leaf(id);
    },
  },
  {
    name: "class instance, field of a class type",
    build: id => {
      const fields = new Fields();
      fields.narrow = new Leaf(id);
      return fields;
    },
    read: (fields: Fields) => fields.narrow!.id,
    replace: (fields: Fields, id) => {
      fields.narrow = new Leaf(id);
    },
  },
  {
    name: "class instance, 40 optional fields",
    build: id => fillWide(new Wide(), id),
    read: readWide,
    replace: (wide: Wide, id) => {
      fillWide(wide, id);
    },
  },
  { name: "class instance, undeclared property", build: id => withLeaf(new Fields(), id), read: fields => fields.leaf.id, replace: withLeaf },
  {
    name: "captured variable that is reassigned",
    build: id => createVariable(new Leaf(id)),
    read: variable => variable.get().id,
    replace: (variable, id) => {
      variable.set(new Leaf(id));
    },
  },
  { name: "arrow function", build: id => capture(new Leaf(id)), read: arrow => arrow().id },
  {
    name: "arrow function with a property",
    build: id => {
      const arrow: any = capture(new Leaf(id));
      arrow.x = 1;
      return arrow;
    },
    read: arrow => (arrow.x === 1 ? arrow().id : -1),
  },
  {
    name: "arrow function, first property stored once the function is old",
    build: id => capture(new Leaf(id)),
    read: arrow => (arrow().id > 0 ? (arrow.leaf ?? arrow()).id : -1),
    replace: withLeaf,
  },
  { name: "function used as a constructor", build: id => createConstructor(new Leaf(id)), read: constructor => new constructor().leaf.id },
  { name: "class with a static field", build: id => createClass(new Leaf(id)), read: classObject => classObject.leaf.id, replace: withLeaf },
  { name: "function from text evaluated at run time", build: id => new Function("leaf", "return () => leaf")(new Leaf(id)), read: arrow => arrow().id },
  {
    name: "suspended generator",
    build: id => {
      const generator = suspend(new Leaf(id));
      generator.next();
      return generator;
    },
    read: generator => generator.next().value,
  },
  { name: "bound this of a compiled function", build: id => getThisID.bind(new Leaf(id)), read: bound => bound() },
  { name: "bound arguments of a compiled function", build: id => getArgumentsID.bind(null, new Leaf(id), new Leaf(id)), read: bound => bound() },
  {
    name: "array of objects",
    build: id => [new Leaf(id), new Leaf(id)],
    read: (array: Leaf[]) => same(...array.map(leaf => leaf.id)),
    replace: (array: Leaf[], id) => {
      array[0] = new Leaf(id);
      array[1] = new Leaf(id);
    },
  },
  {
    name: "array of integers with a property",
    build: id => withLeaf([id, id + 1], id),
    read: array => same(array[0], array[1] - 1, array.leaf.id),
    replace: (array, id) => {
      array[0] = id;
      array[1] = id + 1;
      withLeaf(array, id);
    },
  },
  {
    name: "array of doubles with a property",
    build: id => withLeaf([id + 0.5, cellLikeDouble], id),
    read: array => (array[1] === cellLikeDouble ? same(array[0] - 0.5, array.leaf.id) : -1),
    replace: (array, id) => {
      array[0] = id + 0.5;
      withLeaf(array, id);
    },
  },
  { name: "array of holes with a property", build: id => withLeaf(new Array(4), id), read: array => (array.length === 4 && !(0 in array) ? array.leaf.id : -1), replace: withLeaf },
  {
    name: "copy-on-write array literals",
    build: id => withLeaf(createLiterals(), id),
    read: literals => (`${literals.strings}|${literals.integers}|${literals.doubles}` === "left,right|1,2,3|1.5,2.5" ? literals.leaf.id : -1),
  },
  {
    name: "sparse array",
    build: id => {
      const array: Leaf[] = [];
      array[0] = new Leaf(id);
      array[sparseIndex] = new Leaf(id);
      return array;
    },
    read: (array: Leaf[]) => same(array[0].id, array[sparseIndex].id),
    replace: (array: Leaf[], id) => {
      array[0] = new Leaf(id);
      array[sparseIndex] = new Leaf(id);
    },
  },
  {
    name: "rope",
    build: createRope,
    read: (text: string) => {
      const id = Number(text.slice(-4));
      return text === createRope(id) ? id : -1;
    },
  },
  {
    name: "rope with three fibers",
    build: createLongRope,
    read: (text: string) => {
      const id = Number(text.slice(-4));
      return text === createLongRope(id) ? id : -1;
    },
  },
  {
    name: "substring",
    build: createSubstring,
    read: (text: string) => {
      const id = Number(text.slice(10, 14));
      return text === createSubstring(id) ? id : -1;
    },
  },
  objectCase("object literal", () => ({}), 3),
  objectCase("object literal", () => ({}), 300),
  objectCase("parsed object", () => JSON.parse("{}"), 3),
  objectCase("parsed object", () => JSON.parse("{}"), 300),
  {
    name: "object with property names of its own",
    build: id => {
      const object: any = {};
      for (let i = 0; i < 5; i++) object["n" + id + "_" + i] = new Leaf(id);
      return object;
    },
    read: object => same(...Object.keys(object).flatMap(key => [Number(key.slice(1, 5)), object[key].id])),
  },
  {
    name: "prototype",
    build: id => Object.create(withLeaf({}, id)),
    read: object => object.leaf.id,
    replace: (object, id) => {
      withLeaf(Object.getPrototypeOf(object), id);
    },
  },
  mapCase(3),
  mapCase(12),
  mapCase(300),
  {
    name: "Map from strings to numbers and objects",
    build: id => new Map<string, unknown>([["number", id + 0.5], ["leaf", new Leaf(id)]]),
    read: (map: Map<string, unknown>) => same((map.get("number") as number) - 0.5, (map.get("leaf") as Leaf).id),
    replace: (map: Map<string, unknown>, id) => {
      map.set("number", id + 0.5);
      map.set("leaf", new Leaf(id));
    },
  },
  {
    name: "Map with a string key and a number key",
    build: id => new Map<string | number, Leaf>().set("key", new Leaf(id)).set(7, new Leaf(id)),
    read: (map: Map<string | number, Leaf>) => same(map.get("key")!.id, map.get(7)!.id),
    replace: (map: Map<string | number, Leaf>, id) => {
      map.set("key", new Leaf(id)).set(7, new Leaf(id));
    },
  },
  { name: "Map with an object key", build: id => new Map([[new Leaf(id), new Leaf(id)]]), read: (map: Map<Leaf, Leaf>) => same(...[...map].flat().map(leaf => leaf.id)) },
  setCase(3),
  setCase(12),
  setCase(300),
  {
    name: "Set with a string and an object",
    build: id => new Set<string | Leaf>().add("key").add(new Leaf(id)),
    read: (set: Set<string | Leaf>) => {
      for (const entry of set) if (typeof entry !== "string") return entry.id;
      return -1;
    },
  },
  {
    name: "constant Set and Map",
    build: id => ({ colors: createColors(), numerals: createNumerals(), leaf: new Leaf(id) }),
    read: ({ colors, numerals, leaf }) => (colors.size === 3 && colors.has("green") && !colors.has("pink") && numerals.size === 3 && numerals.get("three") === 3 ? leaf.id : -1),
  },
  {
    name: "constant Set with a key added at run time",
    build: id => createColors().add("key" + id),
    read: (set: Set<string>) => (set.size === 4 && set.has("blue") ? Number([...set][3].slice(3)) : -1),
  },
  {
    name: "getter and setter",
    build: id => {
      const box = { leaf: new Leaf(id) };
      return Object.defineProperty({}, "leaf", {
        get: () => box.leaf,
        set: (next: Leaf) => {
          box.leaf = next;
        },
      });
    },
    read: object => object.leaf.id,
    replace: withLeaf,
  },
  reactionCase("one reaction", 1),
  reactionCase("three reactions", 3),
  {
    name: "async function suspended at an await",
    build: id => {
      const { promise, resolve } = createPending<void>();
      return { resolve, result: readAfter(promise, new Leaf(id)) };
    },
    read: ({ resolve, result }) => {
      resolve();
      return result;
    },
  },
  {
    name: "Promise.all with one element resolved",
    build: id => {
      const first = createPending<Leaf>();
      const second = createPending<Leaf>();
      const all = Promise.all([first.promise, second.promise]);
      first.resolve(new Leaf(id));
      return { resolve: second.resolve, all };
    },
    read: async ({ resolve, all }) => {
      resolve(new Leaf(0));
      return (await all)[0].id;
    },
  },
  { name: "fulfilled promise", build: id => Promise.resolve(new Leaf(id)), read: async promise => (await promise).id },
  {
    name: "Date with a property",
    build: id => withLeaf(new Date(id), id),
    read: date => same(date.getTime(), date.leaf.id),
    replace: (date, id) => {
      date.setTime(id);
      withLeaf(date, id);
    },
  },
  { name: "Proxy", build: id => new Proxy(withLeaf({}, id), {}), read: proxy => proxy.leaf.id, replace: withLeaf },
  {
    name: "WeakMap value",
    build: id => {
      const key = new Leaf(0);
      return { key, map: new WeakMap([[key, new Leaf(id)]]) };
    },
    read: ({ key, map }) => map.get(key).id,
    replace: ({ key, map }, id) => {
      map.set(key, new Leaf(id));
    },
  },
  {
    name: "instance of a Promise subclass",
    build: id => {
      const promise = Tagged.resolve(new Leaf(id)) as Tagged<Leaf>;
      promise.tag = new Leaf(id);
      return promise;
    },
    read: async (promise: Tagged<Leaf>) => same((await promise).id, promise.tag!.id),
  },
  { name: "bound this of a native function", build: id => Object.prototype.valueOf.bind(new Leaf(id)), read: bound => bound().id },
  { name: "typed array with a property", build: id => withLeaf(new Uint8Array(8), id), read: bytes => (bytes.length === 8 ? bytes.leaf.id : -1), replace: withLeaf },
  { name: "WebAssembly struct", build: id => createStruct(new Leaf(id)), read: struct => readStruct(struct).id },
];

const ring: unknown[] = new Array(64);
function churn(count: number) {
  for (let i = 0; i < count; i++) ring[i & 63] = [new Leaf(-1), { leaf: new Leaf(-1) }, "garbage" + i, () => i];
}

function runYoungCollections() {
  for (let i = 0; i < youngCollectionCount; i++) {
    collectYoung();
    churn(200);
  }
}

async function build(firstID: number) {
  const holders = cases.map((testCase, index) => testCase.build(firstID + index));
  for (let i = 0; i < 10; i++) await null;
  return holders;
}

async function report(phase: string, holders: unknown[], expectedID: (testCase: Case, index: number) => number) {
  for (let index = 0; index < cases.length; index++) {
    const expected = expectedID(cases[index], index);
    let found: unknown;
    try {
      found = await cases[index].read(holders[index]);
    } catch (error) {
      found = error;
    }
    console.log(`${phase}: ${cases[index].name}: ${found === expected ? "ok" : `${found} instead of ${expected}`}`);
  }
}

async function main() {
  let holders = await build(1000);
  collectFull();
  churn(5000);
  await report("full collection", holders, (testCase, index) => 1000 + index);

  holders = await build(2000);
  runYoungCollections();
  await report("young collections", holders, (testCase, index) => 2000 + index);

  holders = await build(3000);
  collectFull();
  cases.forEach((testCase, index) => testCase.replace?.(holders[index], 4000 + index));
  runYoungCollections();
  await report("young leaves in old holders", holders, (testCase, index) => (testCase.replace ? 4000 : 3000) + index);
}

main();
