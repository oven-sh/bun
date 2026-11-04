const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
function two(items: any) { const [a, b] = items; return [a, b]; }
function four(items: any) { const [a, b, c, d] = items; return [a, b, c, d]; }
function* counts(upTo: number) { try { for (let at = 1; at <= upTo; at++) { log.push("yield"); yield at; } log.push("end"); } finally { log.push("finally"); } }
for (let turn = 0; turn < 3; turn++) for (const size of [0, 1, 2, 3, 5]) say(size, two(counts(size)), told(), four(counts(size)), told());
const kept = counts(5); say(two(kept), told(), kept.next(), two(kept), told());
const begun = counts(5); begun.next(); say(two(begun), told());
function* refuses() { try { yield 1; yield 2; yield 3; } finally { yield "from finally"; } } for (let turn = 0; turn < 3; turn++) { const it = refuses(); say(two(it), it.next()); }
function* throwsAtTheEnd() { try { yield 1; yield 2; yield 3; } finally { throw new Error("from finally"); } } for (let turn = 0; turn < 3; turn++) attempt("a generator that throws when closed:", () => two(throwsAtTheEnd()));
function* throwsInside() { yield 1; throw new Error("from the body"); } for (let turn = 0; turn < 3; turn++) attempt("a generator that throws:", () => two(throwsInside()));
const running: any = (function* () { const [a] = running; yield a; })(); attempt("a generator that takes itself apart:", () => running.next());
class Tree { constructor(public value: number, public below: Tree[] = []) {} *[Symbol.iterator](): Generator<number> { yield this.value; for (const child of this.below) yield* child; } }
for (let turn = 0; turn < 3; turn++) say(four(new Tree(1, [new Tree(2, [new Tree(3)]), new Tree(4), new Tree(5)])), two(new Tree(9)));
for (let turn = 0; turn < 3; turn++) say(two(new URLSearchParams("a=1&b=2&c=3")), two(new URLSearchParams("a=1&b=2").keys()), two(new Headers({ x: "1", y: "2" })), two("a1b2c3".matchAll(/[a-z]/g)).map(String), two(new FormData()), two(Iterator.from([7, 8, 9])), two([1, 2, 3].values().map(value => value * 2)), two(new Uint8Array([4, 5, 6])), two((function () { return arguments; } as any)(6, 7, 8)));
for (let turn = 0; turn < 3; turn++) say(two(new Map([[1, 2], [3, 4], [5, 6]])), two(new Set([1, 2, 3])), two(new Map([[1, 2]]).keys()), two(new Set([9]).entries()), two("xyz"), two("\u{1F600}b"), two([1, , 3]), two([1]), two(new Proxy([1, 2, 3], {})));
async function later(items: any) { await null; const [a, b] = items; await null; return [a, b]; } say(await later(counts(3)), told(), await later(new Tree(1, [new Tree(2)])));
function* inside(items: any) { const [a, b] = items; yield a; yield b; } say([...inside(counts(4))], told());
