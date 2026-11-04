const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
// How often `next` is called, whether `return` is, and in which order: each pattern runs three times.
class Counts { constructor(public upTo: number) {} [Symbol.iterator]() { log.push("open"); let at = 0; const upTo = this.upTo; return { next() { log.push("next"); return at < upTo ? { done: false, value: ++at } : { done: true, value: undefined }; }, return() { log.push("return"); return {}; } }; } }
function two(items: Iterable<number>) { const [a, b] = items; return [a, b]; }
function four(items: Iterable<number>) { const [a, b, c, d] = items; return [a, b, c, d]; }
function one(items: Iterable<number>) { const [a] = items; return [a]; }
function none(items: Iterable<number>) { const [] = items; return "nothing"; }
function skips(items: Iterable<number>) { const [, , c] = items; return [c]; }
function assigns(items: Iterable<number>) { let a, b; [a, b] = items; return [a, b]; }
function takes([a, b]: any) { return [a, b]; }
for (let turn = 0; turn < 3; turn++) for (const size of [0, 1, 2, 3, 4, 5]) { const items = new Counts(size); say(turn, size, two(items), told(), four(items), told(), one(items), told(), none(items), told(), skips(items), told(), assigns(items), told(), takes(items), told()); }
box.items = new Counts(3); for (let turn = 0; turn < 3; turn++) { const [a, b] = box.items; say(a, b, told()); const [c, d, e, f] = box.items; say(c, d, e, f, told()); }
const noReturn = { [Symbol.iterator]() { let at = 0; return { next() { log.push("next"); return { done: false, value: ++at }; } }; } }; for (let turn = 0; turn < 3; turn++) say(two(noReturn), told());
const nested = { *[Symbol.iterator]() { yield new Counts(2); yield new Counts(1); } }; for (let turn = 0; turn < 3; turn++) { const [[a, b], [c, d]] = nested as any; say(a, b, c, d, told()); }
for (let turn = 0; turn < 3; turn++) for (const [a, b] of [new Counts(5), new Counts(1)] as any) say(a, b, told());
