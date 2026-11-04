const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
const odd: unknown[] = ["s", 2, NaN, -0, null, undefined, 10n, Symbol.iterator, { o: 1 }, [1], true, 1.5, 2 ** 40, ""];
const own = (values: unknown[]) => ({ [Symbol.iterator]() { let at = 0; return { next: () => at < values.length ? { done: false, value: values[at++] } : { done: true, value: "the value beside done is not taken" } }; } });
function all(items: any) { const [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p] = items; return [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p]; }
for (let turn = 0; turn < 3; turn++) for (const value of all(own(odd))) say(typeof value, value);
function numbers(items: Iterable<number>) { const [a, b, c] = items; return [1 / a, a + b, b * c, a === 0, Object.is(a, -0)]; } for (let turn = 0; turn < 3; turn++) say(numbers(own([-0, 1.5, 2 ** 31]) as any), numbers(own([0, NaN, 1]) as any), numbers(own([2 ** 53, 1]) as any));
function defaults(items: any) { const [a = "a", b = (log.push("evaluated"), "b"), c = a] = items; return [a, b, c]; } for (let turn = 0; turn < 3; turn++) say(defaults(own([])), told(), defaults(own([undefined, null, 0])), told(), defaults(own([1, 2, 3, 4])), told());
function rest(items: any) { const [a, ...others] = items; return [a, others]; } for (let turn = 0; turn < 3; turn++) say(rest(own([])), rest(own([1])), rest(own([1, 2, 3])));
function deep(items: any) { const [{ x }, [y, [z]]] = items; return [x, y, z]; } for (let turn = 0; turn < 3; turn++) say(deep(own([{ x: 1 }, own([2, own([3])])])));
function swaps(items: any) { let [a, b] = items; [a, b] = own([b, a]) as any; return [a, b]; } for (let turn = 0; turn < 3; turn++) say(swaps(own([1, 2])));
const target: any = {}; function intoFields(items: any) { [target.a, target["b"], target.list] = items; return target; } for (let turn = 0; turn < 3; turn++) say(intoFields(own([turn, "b", [turn]])));
const same = { o: 1 }; const [first, second] = own([same, same]) as any; say(first === same, first === second);
let total = 0; const many = own([1, 2, 3, 4]); for (let turn = 0; turn < 20000; turn++) { const [a, b, c, d] = many as any; total += a + b + c + d; } say(total);
function wide(items: any) { const [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, d0, d1, d2, d3, d4, d5, d6, d7, d8, d9] = items; return a0 + a9 + b0 + b9 + c0 + c9 + d0 + d9 + (a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8); } for (let turn = 0; turn < 3; turn++) say(wide(own(Array.from({ length: 45 }, (_, index) => index))));
