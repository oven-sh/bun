// Methods of a class below a built-in class go through `super`, replace accessors and methods of the parent, are asynchronous or generators, and are reached through three classes, one of them abstract.
const lines: string[] = [];
abstract class Base extends Map<string, number> {
  reads = 0;
  abstract scale(): number;
  get(key: string): number | undefined { this.reads++; const found = super.get(key); return found === undefined ? undefined : found * this.scale(); }
  get size(): number { return super.size + 100; }
  has(key: string): boolean { return super.has(key) || key === "always"; }
  static create<T extends Base>(this: new () => T): T { return new this(); }
}
class Middle extends Base {
  factor = 2;
  scale(): number { return this.factor; }
  *pairs(): Generator<string> { for (const [key, value] of super.entries()) yield key + value * this.factor; }
  async later(key: string): Promise<number> { await null; return (this.get(key) ?? -1) + this.reads; }
  [Symbol.iterator](): MapIterator<[string, number]> { lines.push("iterated"); return super[Symbol.iterator](); }
}
class Leaf extends Middle {
  factor = 3;
  extra = "leaf";
  scale(): number { return super.scale() + 1; }
  get size(): number { return super.size + 1000; }
  toString(): string { return this.extra + super.toString(); }
  get [Symbol.toStringTag](): string { return "Leaf"; }
}
function use(k: Base): string { return k.get("a") + ":" + k.get("z") + ":" + k.size + ":" + k.has("a") + k.has("always") + k.has("no") + ":" + k.reads; }
function useMiddle(k: Middle): string { return [...k.pairs()].join() + ":" + [...k].length + ":" + k.factor + ":" + new Map(k).size; }
function useLeaf(k: Leaf): string { return String(k) + ":" + k.extra + ":" + Object.prototype.toString.call(k) + ":" + `${k}`; }
class Failure extends Error {
  get message(): string { return "got " + this.code; }
  set message(value: string) { lines.push("message is set to " + value); }
  code = 1;
  get name(): string { return "Failure" + this.code; }
  toJSON(): object { return { code: this.code, name: this.name }; }
}
function useFailure(k: Failure): string { return k.message + "|" + k.name + "|" + String(k) + "|" + JSON.stringify(k) + "|" + Object.keys(k).join(); }
const waits: Promise<unknown>[] = [];
for (let round = 0; round < 3; round++) {
  for (const k of [Middle.create(), Leaf.create(), new Leaf()]) {
    k.set("a", 1).set("b", 2);
    lines.push(use(k), useMiddle(k));
    if (k instanceof Leaf) lines.push(useLeaf(k));
    waits.push(k.later("b").then(value => lines.push("later " + value)));
  }
  lines.push(useFailure(new Failure("given")));
  Bun.gc(true);
}
await Promise.all(waits);
console.log(lines.join("\n"));
export {};
