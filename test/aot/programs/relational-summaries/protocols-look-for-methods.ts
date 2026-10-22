// The language itself calls methods of an object that a helper "only" loops over, spreads, awaits, returns from an async function, tests with instanceof, turns into JSON, clones or copies. Each of these methods gets the object as `this` (or as an operand) and keeps it.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept: { tag: string }[] = [];
const report = () => kept.splice(0).map(k => k.tag).join("+");

// Iteration.
class Range {
  constructor(
    public tag: string,
    public to: number,
  ) {}
  [Symbol.iterator](): Iterator<number> {
    kept.push(this);
    let i = 0;
    return { next: () => (i < this.to ? { value: i++, done: false } : { value: undefined, done: true }) };
  }
}
function sumOf(items: Iterable<number>): number {
  let sum = 0;
  for (const n of items) sum += n;
  return sum;
}
const spread = (items: Iterable<number>): number => Math.max(-1, ...items);
const intoList = (items: Iterable<number>): number => [...items].length;
const firstOf = (items: Iterable<number>): number | undefined => {
  const [first] = items;
  return first;
};
const byFrom = (items: Iterable<number>): number => Array.from(items).length;
const bySet = (items: Iterable<number>): number => new Set(items).size;
function* delegating(items: Iterable<number>): Generator<number> {
  yield* items;
}
let warm = 0;
for (let i = 0; i < 500; i++) warm += sumOf([i, 1]) + spread([i]) + intoList([i, i]) + firstOf([i])! + byFrom([i]) + bySet([i, i]) + sumOf(delegating([i]));
console.log(warm);
console.log(sumOf(new Range("for-of", 3)), spread(new Range("spread", 3)), intoList(new Range("list", 3)), firstOf(new Range("pattern", 3)), byFrom(new Range("from", 3)), bySet(new Range("set", 3)), sumOf(delegating(new Range("yield*", 3))), churn(30), report());

// An iterator that is closed early: `return` is called, with the iterator as `this`.
class Closable {
  closed = 0;
  constructor(public tag: string) {}
  [Symbol.iterator](): Iterator<number> {
    return this;
  }
  next(): IteratorResult<number> {
    return { value: 1, done: false };
  }
  return(): IteratorResult<number> {
    this.closed++;
    kept.push(this);
    return { value: undefined, done: true };
  }
}
function takesOne(items: Iterable<number>): number {
  for (const n of items) return n;
  return -1;
}
function breaksOut(items: Iterable<number>): number {
  let n = 0;
  for (const x of items) if ((n += x) > 2) break;
  return n;
}
function throwsInside(items: Iterable<number>): string {
  try {
    for (const x of items) throw new Error("inside " + x);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}
console.log(takesOne(new Closable("returned")), breaksOut(new Closable("broken")), throwsInside(new Closable("thrown")), firstOf(new Closable("pattern")), report());

// Thenables.
class Lazy {
  constructor(public tag: string) {}
  then(resolve: (value: string) => void): void {
    kept.push(this);
    resolve("resolved " + this.tag);
  }
}
async function awaits(x: unknown): Promise<unknown> {
  return await x;
}
async function returns(x: unknown): Promise<unknown> {
  return x;
}
const resolves = (x: unknown): Promise<unknown> => Promise.resolve(x);
const chains = (x: unknown): Promise<unknown> => Promise.resolve(0).then(() => x);
const all = (x: unknown): Promise<unknown> => Promise.all([x]).then(list => list[0]);
const byExecutor = (x: unknown): Promise<unknown> => new Promise(resolve => resolve(x));
for (let i = 0; i < 50; i++) await awaits({ tag: "plain" + i });
const pending = [awaits(new Lazy("await")), returns(new Lazy("return")), resolves(new Lazy("resolve")), chains(new Lazy("then")), all(new Lazy("all")), byExecutor(new Lazy("executor"))];
churn(40);
console.log((await Promise.all(pending)).join(), kept.length, kept.map(k => k.tag).sort().join("+"));
kept.length = 0;
const withGetter = (tag: string) => ({
  tag,
  get then() {
    kept.push(this);
    return undefined;
  },
});
console.log(((await awaits(withGetter("a getter named then"))) as { tag: string }).tag, report());

// instanceof.
class Club {
  static [Symbol.hasInstance](candidate: { tag: string }): boolean {
    kept.push(candidate);
    return candidate.tag.startsWith("member");
  }
}
function isMember(x: { tag: string }): boolean {
  return x instanceof Club;
}
function isInstance(x: object, C: Function): boolean {
  return x instanceof C;
}
for (let i = 0; i < 300; i++) warm += isInstance({ tag: "t" }, Range) ? 1 : 0;
console.log(isMember({ tag: "member 1" }), isMember({ tag: "guest" }), isInstance({ tag: "member 2" }, Club), isInstance({ tag: "x" }, Range), churn(20), report());

// JSON, cloning, copying, inspecting.
class Account {
  constructor(
    public tag: string,
    public balance: number,
  ) {}
  toJSON(key: string): unknown {
    kept.push(this);
    return { tag: this.tag, under: key };
  }
}
const toText = (x: unknown): string => JSON.stringify(x);
const nested = (x: unknown): string => JSON.stringify({ inner: [x] });
for (let i = 0; i < 300; i++) warm += toText({ tag: "t", balance: i }).length;
console.log(toText(new Account("direct", 1)), nested(new Account("nested", 2)), report());
const spying = (tag: string) => ({
  tag,
  get secret() {
    kept.push(this);
    return 1;
  },
});
const copies: ((x: object) => unknown)[] = [x => ({ ...x }), x => Object.assign({}, x), x => Object.entries(x), x => Object.values(x), x => structuredClone(x), x => JSON.stringify(x), x => Object.fromEntries(Object.entries(x)), x => Bun.inspect(x), x => Bun.deepEquals(x, { tag: "" })];
copies.forEach((copy, i) => copy(spying("copy " + i)));
console.log(churn(20), report());
console.log(Object.keys(spying("keys do not read")).join(), Object.getOwnPropertyNames(spying("names do not read")).length, "secret" in spying("in does not read"), report() === "");

// Species and constructors that built-ins look up.
class Tracked extends Array<number> {
  tag = "tracked";
  static get [Symbol.species]() {
    kept.push({ tag: "species asked" });
    return Array;
  }
}
const mapped = (list: number[]) => list.map(n => n + 1);
for (let i = 0; i < 300; i++) warm += mapped([i]).length;
console.log(mapped(Tracked.from([1, 2])).constructor.name, report());
class MyPromise<T> extends Promise<T> {
  static made = 0;
  constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void) {
    super(executor);
    MyPromise.made++;
  }
}
const thenOn = (p: Promise<number>) => p.then(n => n + 1);
console.log(thenOn(MyPromise.resolve(1)) instanceof MyPromise, MyPromise.made, await thenOn(MyPromise.resolve(1)), await thenOn(Promise.resolve(5)));

// Disposal.
class Resource {
  constructor(public tag: string) {}
  [Symbol.dispose](): void {
    kept.push(this);
  }
}
function uses(tag: string): string {
  using resource = new Resource(tag);
  return resource.tag;
}
console.log(uses("disposed"), churn(10), report(), warm);
