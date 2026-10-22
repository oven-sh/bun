// A fresh object is not an empty one. A copy is born with what its source holds, a literal of constants with its constants, and the
// rest of a destructuring with everything that was not named. Whoever lists the stores into such a result and takes the list for
// the whole object reads `undefined`, or the one store that is listed, where the caller finds something else.
type Thing = { tag: string; n: number; a?: Thing | null; x?: unknown; y?: unknown };
type Bag = Record<string, unknown>;

const lines: string[] = [];
const say = (name: string, ...what: unknown[]) => lines.push(name + ": " + what.map(show).join(" "));
function show(v: unknown): string {
  if (v === null || typeof v !== "object") return typeof v === "symbol" ? v.toString() : typeof v === "string" ? JSON.stringify(v) : String(v);
  if (Array.isArray(v)) return "[" + v.map(show).join() + "]";
  return "{" + Reflect.ownKeys(v).map(k => String(k) + "=" + show((v as Bag)[k as string])).join() + "}";
}

const copyThenName = (prev: Thing, x: unknown) => ({ ...prev, x });
const nameThenCopy = (prev: Thing, x: unknown) => ({ x, ...prev });
const copyOnly = (prev: Thing) => ({ ...prev });
const copyTwo = (first: Thing, second: Thing) => ({ ...first, ...second });
const copyBetween = (prev: Thing, x: unknown, y: unknown) => ({ x, ...prev, y });
const restOf = ({ x, ...rest }: Thing) => rest;
const restWithoutKey = (p: Bag, k: string) => {
  const { [k]: gone, ...rest } = p;
  return rest;
};
const constants = () => ({ x: 3, tag: "p" });
const constantsThenStore = (v: unknown) => {
  const p: Bag = { x: 3, tag: "p" };
  p.y = v;
  return p;
};
const constantsThenStoreOnOnePath = (v: unknown, c: boolean) => {
  const p: Bag = { x: 3, tag: "p" };
  if (c) p.x = v;
  return p;
};
const constantsNested = () => ({ x: { n: 1 }, list: [1, 2, 3], tag: "p" });
const assigned = (prev: Thing, x: unknown) => Object.assign({ x }, prev);
const copyOfCopy = (prev: Thing, x: unknown) => ({ ...copyThenName(prev, x) });

let sum = 0;
let same = 0;
for (let i = 0; i < 400; i++) {
  const inner: Thing = { tag: "inner", n: i };
  const prev: Thing = { tag: "prev", n: i, a: inner, x: "of prev" };
  const bare: Thing = { tag: "bare", n: i, a: inner };
  const mine = { mine: i };

  const r1 = copyThenName(prev, mine);
  const r2 = nameThenCopy(prev, mine);
  const r3 = nameThenCopy(bare, mine);
  const r4 = copyOnly(prev);
  const r5 = copyTwo(prev, bare);
  const r6 = copyBetween(prev, mine, mine);
  const r7 = restOf(prev);
  const r8 = restWithoutKey(prev as unknown as Bag, i % 2 ? "a" : "n");
  const r9 = constants();
  const r10 = constantsThenStore(mine);
  const r11 = constantsThenStoreOnOnePath(mine, i % 3 === 0);
  const r12 = constantsNested();
  const r13 = assigned(prev, mine);
  const r14 = copyOfCopy(prev, mine);

  same += +(r1.x === mine) + +(r1.a === inner) + +(r1.tag === "prev") + +(r1.n === i);
  same += +(r2.x === "of prev") + +(r2.a === inner) + +(r3.x === mine) + +(r3.a === inner);
  same += +(r4.x === "of prev") + +(r4.a === inner) + +((r4 as Thing) !== prev);
  same += +(r5.tag === "bare") + +(r5.x === "of prev") + +(r5.a === inner);
  same += +(r6.x === "of prev") + +(r6.y === mine) + +(r6.n === i);
  same += +(r7.a === inner) + +!("x" in r7) + +(r7.tag === "prev");
  same += +(("a" in r8) === (i % 2 === 0)) + +(("n" in r8) === (i % 2 === 1)) + +(r8.x === "of prev");
  same += +(r9.x === 3) + +(r9.tag === "p") + +(r10.x === 3) + +(r10.y === mine) + +(r10.tag === "p");
  same += +(r11.x === (i % 3 === 0 ? mine : 3)) + +(r11.tag === "p");
  same += +(r12.x.n === 1) + +(r12.list[2] === 3) + +(r12.list.length === 3);
  same += +(r13.x === "of prev") + +(r13.a === inner) + +(r14.x === mine) + +(r14.a === inner) + +(r14.n === i);

  prev.n = -1;
  prev.a = null;
  r9.x = 4;
  r12.x.n = 2;
  r12.list.push(4);
  sum += r1.n + r4.n + r14.n + (r1.a === inner ? 1 : 0) + constants().x + constantsNested().x.n + constantsNested().list.length;
  r1.n = -2;
  sum += prev.n;
}
say("in the loop", same, sum);

const hidden = Symbol("hidden");
const proto = { inherited: "from the prototype" };
const rich: Bag = Object.create(proto);
rich.plain = 1;
rich[hidden as unknown as string] = "by a symbol";
Object.defineProperty(rich, "unseen", { value: "not enumerable", enumerable: false });
let reads = 0;
Object.defineProperty(rich, "computed", { get: () => ++reads, enumerable: true });
const copies = [0, 1, 2].map(() => copyOnly(rich as unknown as Thing) as unknown as Bag);
say("a getter is read once a copy", copies.map(c => c.computed), reads);
say("what is copied", copies[0], "inherited" in copies[0], "unseen" in copies[0], Object.getPrototypeOf(copies[0]) === Object.prototype);
say("the copy has a value where the source has a getter", Object.getOwnPropertyDescriptor(copies[2], "computed"));

const spreadAnything = (v: unknown, x: unknown) => ({ ...(v as object), x });
say("of null and undefined", spreadAnything(null, 1), spreadAnything(undefined, 2));
say("of a string, an array, a number", spreadAnything("ab", 1), spreadAnything([7, 8], 2), spreadAnything(5, 3));
say("of a key that looks like the prototype", Object.getPrototypeOf(spreadAnything(JSON.parse('{"__proto__":{"evil":1}}'), 1)) === Object.prototype);

const asked: string[] = [];
const keptByTraps: unknown[] = [];
const watched = new Proxy({ x: "of the target", z: 1 } as Bag, {
  ownKeys(target) {
    asked.push("ownKeys");
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, key) {
    asked.push("descriptor " + String(key));
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
  get(target, key, receiver) {
    asked.push("get " + String(key));
    keptByTraps.push(receiver);
    return Reflect.get(target, key, receiver);
  },
});
say("of a proxy", nameThenCopy(watched as unknown as Thing, "mine"), asked.join(), keptByTraps.every(r => r === watched));

const throwing = Object.defineProperty({ before: 1 } as Bag, "bad", {
  get() {
    throw new Error("from the getter");
  },
  enumerable: true,
});
try {
  copyThenName(throwing as unknown as Thing, 1);
} catch (e) {
  say("a getter that throws", (e as Error).message);
}

const order = copyBetween({ tag: "t", n: 1, y: "early", x: "late" }, "first", "last");
say("the order of the keys", Object.keys(order).join());
say("numbers come first", Object.keys(spreadAnything({ b: 1, 2: 1, a: 1, 1: 1 }, 0)).join());

console.log(lines.join("\n"));
