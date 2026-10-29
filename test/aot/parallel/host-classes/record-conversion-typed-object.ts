// A typed object as the record argument of `new Headers()` and `new URLSearchParams()`: its own enumerable keys in creation order, each value read and converted in that order, as in plain Bun.
interface Init { [name: string]: string }
interface Closed { accept: string; host: string }
interface Optional { first?: string; second: string; third: string }
interface Mixed { count: number; ratio: number; on: boolean; none: null; missing: undefined; big: bigint }
interface Stringified { a: string; b: { toString(): string }; c?: string }
class Query { #secret = "s"; constructor(public q: string, public page: number) {} describe() { return this.q + this.#secret; } }
function hide(value: unknown): any { return value; }
const log: string[] = [];
let count = 0;
function attempt(convert: () => unknown): string {
  try { return JSON.stringify(convert()); } catch (e) { return "THROWN " + (e as Error).name + ": " + (e as Error).message; }
}
function show(name: string, make: () => unknown) {
  const headers = attempt(() => [...new Headers(hide(make()))]);
  const query = attempt(() => new URLSearchParams(hide(make())).toString());
  console.log(String(++count).padStart(2, "0"), name + ":", headers, query, "log: " + log.splice(0).join());
}
const closed = (): Closed => ({ accept: "text/plain", host: "example.com" });

show("index signature", () => { const init: Init = { accept: "a", "x-one": "1" }; init["x-late"] = "l"; return init; });
show("closed literal", closed);
show("class instance", () => new Query("bun", 2));
show("optional field absent", (): Optional => ({ second: "2", third: "3" }));
show("optional field set late", () => { const x: Optional = { second: "2", third: "3" }; x.first = "1"; return x; });
show("optional field set to undefined", () => { const x: Optional = { second: "2", third: "3" }; x.first = undefined; return x; });
show("optional field deleted and set again", () => { const x: Optional = { first: "1", second: "2", third: "3" }; delete x.first; x.first = "again"; return x; });
show("numbers, booleans, nullish, bigint", (): Mixed => ({ count: 1, ratio: 1.5, on: true, none: null, missing: undefined, big: 10n }));
show("numbers with special text", (): Mixed => ({ count: -0, ratio: NaN, on: false, none: null, missing: undefined, big: -(2n ** 64n) }));
show("a rope and 16-bit text", (): Closed => ({ accept: "left".repeat(3) + count, host: "значение" }));
show("non-enumerable field", () => { const x = closed(); Object.defineProperty(hide(x), "host", { enumerable: false }); return x; });
show("extra property", () => { const x = closed(); hide(x).extra = "e"; return x; });
show("extra non-enumerable property", () => { const x = closed(); Object.defineProperty(hide(x), "hidden", { value: "h", enumerable: false, writable: true, configurable: true }); return x; });
show("extra read-only property", () => { const x = closed(); Object.defineProperty(hide(x), "fixed", { value: "f", enumerable: true, writable: false, configurable: false }); return x; });
show("non-enumerable symbol key", () => { const x = closed(); Object.defineProperty(hide(x), Symbol("s"), { value: "v", enumerable: false, writable: true, configurable: true }); return x; });
show("frozen", () => { const x = closed(); Object.freeze(x); return x; });
show("sealed with an extra property", () => { const x = closed(); hide(x).extra = "e"; Object.seal(x); return x; });
show("empty", (): { o?: string } => ({}));
show("symbol value", () => ({ a: "1", s: Symbol("s"), z: "26" }));
show("keys equal after conversion", () => { const init: Init = { z: "26" }; init["\ud800"] = "1"; init["�"] = "2"; return init; });

const reused = closed();
hide(reused).extra = "e";
show("one object, converted twice", () => reused);
reused.host = "changed";
hide(reused).extra = "f";
show("the same object after two stores", () => reused);
hide(reused).more = "m";
delete hide(reused).extra;
show("the same object after an addition and a deletion", () => reused);

show("toString deletes a later key", () => { const init: Stringified = { a: "1", b: { toString() { log.push("b"); delete init.c; return "2"; } }, c: "3" }; return init; });
show("toString changes a later value", () => { const init: Stringified = { a: "1", b: { toString() { log.push("b"); init.c = "changed"; return "2"; } }, c: "3" }; return init; });
show("toString adds a key", () => { const init: Stringified = { a: "1", b: { toString() { log.push("b"); hide(init).d = "4"; return "2"; } }, c: "3" }; return init; });
show("toString throws", () => { const init: Stringified = { a: "1", b: { toString() { log.push("b"); throw new RangeError("from toString"); } }, c: "3" }; return init; });
show("array value", () => ({ a: "1", list: ["x", "y"], z: "26" }));
show("accessor", () => { const x = closed(); Object.defineProperty(hide(x), "got", { get() { log.push("get"); return "g"; }, enumerable: true, configurable: true }); return x; });
show("accessor replaces a field", () => { const x = closed(); Object.defineProperty(hide(x), "accept", { get() { log.push("get"); return "g"; }, enumerable: true, configurable: true }); return x; });
show("index-like keys", () => { const x = closed(); hide(x)[7] = "seven"; hide(x)["0"] = "zero"; return x; });
show("enumerable symbol key", () => { const x = closed(); hide(x)[Symbol("s")] = "v"; return x; });
show("enumerable symbol key after a value that logs", () => { const init: Stringified = { a: "1", b: { toString() { log.push("b"); return "2"; } } }; hide(init)[Symbol("s")] = "v"; return init; });
