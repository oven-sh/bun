// `f(...x)` for every kind of iterable and for values that are not iterable, with the order of evaluation.
declare const console: any;
const log: any[] = [];
function attempt(what: string, run: () => any) { try { log.push(what + ": " + String(run())); } catch (e: any) { log.push(what + " throws " + e.constructor.name); } }
const show: any = function (this: any, ...a: any[]) { return a.length + " [" + a.map(String).join(",") + "] " + String(this); };
const two: any = (a: any, b: any) => String(a) + "|" + String(b);
function* generate() { log.push("generator started"); yield 1; yield 2; log.push("generator done"); }
const ownIterator: any = [1, 2, 3]; ownIterator[Symbol.iterator] = function* () { yield "own"; };
const holes: any[] = [1, , 3];
const long: any[] = []; for (let i = 0; i < 20; i++) long.push(i);
const closing = { [Symbol.iterator]() { return { next() { log.push("next"); return { done: true, value: undefined }; }, return() { log.push("return"); return {}; } }; } };
const things: [string, any][] = [["empty", []], ["one", [1]], ["eight", [1, 2, 3, 4, 5, 6, 7, 8]], ["nine", [1, 2, 3, 4, 5, 6, 7, 8, 9]], ["long", long], ["holes", holes], ["doubles", [1.5, 2.5]],
  ["own iterator", ownIterator], ["frozen", Object.freeze([1, 2])], ["string", "ab"], ["set", new Set([1, 2])], ["map", new Map([[1, 2]])], ["generator", generate()], ["typed array", new Uint8Array([1, 2])],
  ["closing", closing], ["undefined", undefined], ["null", null], ["number", 1], ["object", {}], ["array-like", { length: 1, 0: "x" }], ["function", () => 1]];
for (const f of [show, two, Math.max, undefined, {}]) {
  for (const [name, thing] of things) attempt(name, () => (f as any)(...thing));
}
// The arguments are evaluated before the callee is found not to be callable.
attempt("not callable", () => (undefined as any)(...generate()));
const o: any = { m(this: any, ...a: any[]) { return (this === o) + " " + a.join(","); } };
log.push(o.m(...[1, 2]), o.m(0, ...[1, 2]), o.m(...[1], ...[2, 3]), o.m(...[1, 2], 3), o.m(...[]), show(...[1, 2], ...new Set([3])));
function inner(a: number, b: number, c?: number) { return a + b + (c === undefined ? 100 : c); }
function forward(...r: [number, number]) { return inner(...r); }
function prefixed(x: number, ...r: [number]) { return inner(x, ...r); }
function changed(...r: number[]) { r.push(5); return (inner as any)(...r); }
function twice(...r: [number, number]) { return inner(...r) + inner(...r); }
log.push(forward(1, 2), prefixed(1, 2), changed(1, 2), twice(1, 2), [...[1, 2], ...[3]].length, [0, ...[1, 2]].join(""));
try { log.push(show(...[1, 2]), (undefined as any)(...[1])); } catch (e: any) { log.push("caught " + e.constructor.name); }
console.log(log.join("\n"));
export {};
