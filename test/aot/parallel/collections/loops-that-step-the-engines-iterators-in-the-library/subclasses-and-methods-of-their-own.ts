// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has.
const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
function all(name: string) { const seen: unknown[] = []; for (const value of box[name]) seen.push(value); return seen; }
class Plain extends Map<string, number> {}
class Own extends Map<string, number> { [Symbol.iterator](): any { return ["of the class"][Symbol.iterator](); } }
class Generated extends Set<number> { *[Symbol.iterator](): any { yield "generated"; yield* super.values(); } }
class Counts extends Map<string, number> { calls = 0; entries() { this.calls++; return super.entries(); } }
const pairs: [string, number][] = [["a", 1], ["b", 2]];
box.plain = new Plain(pairs); box.own = new Own(pairs); box.generated = new Generated([1, 2]); box.counts = new Counts(pairs);
say(all("plain"), all("own"), all("generated"), all("counts"), box.counts.calls);
box.instance = new Map(pairs); box.instance[Symbol.iterator] = function () { return ["on the instance"].values(); }; say(all("instance"));
box.getter = new Set([1]); let reads = 0; Object.defineProperty(box.getter, Symbol.iterator, { get() { reads++; return () => [reads].values(); } }); say(all("getter"), all("getter"), reads);
// `next` is read once, when the loop opens.
box.stepped = new Map(pairs).values(); box.stepped.next = function () { return { done: true, value: "never seen" }; }; say(all("stepped"));
let calls = 0; box.counted = new Set([1, 2]).values(); const real = box.counted.next; box.counted.next = function () { calls++; return real.call(this); }; say(all("counted"), calls);
box.late = new Set([1, 2, 3]).values(); const late: unknown[] = []; for (const value of box.late) { late.push(value); box.late.next = () => ({ done: true }); } say(late);
let lookups = 0; box.watched = new Set([1, 2]).values(); Object.defineProperty(box.watched, "next", { get() { lookups++; return real; } }); say(all("watched"), lookups);
// A `return` of its own is called when the loop is left early, and only then.
const left: string[] = []; box.closes = new Map(pairs).keys(); box.closes.return = function () { left.push("return"); return {}; };
for (const key of box.closes) { left.push(key); break; } say(left, box.closes.next());
box.whole = new Map(pairs).keys(); box.whole.return = function () { left.push("never"); return {}; }; say(all("whole"), left);
box.bad = new Set([1]).values(); box.bad.return = () => 5; attempt("return gives no object", () => { for (const _ of box.bad) break; });
box.thrown = new Set([1]).values(); box.thrown.return = () => { left.push("closed by a throw"); return 5; }; attempt("a throw in the body", () => { for (const _ of box.thrown) throw new Error("body"); }); say(left);
box.below = new Set([1, 2]).values(); Object.setPrototypeOf(box.below, { next() { return { done: true }; }, [Symbol.iterator]() { return this; } }); say(all("below"));
box.noProto = new Set([1]).values(); Object.setPrototypeOf(box.noProto, null); attempt("no prototype", () => all("noProto"));
