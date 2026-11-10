interface Q { readonly min: number; readonly max: number }
const log: string[] = [];
function walk(it: any, q: Q): string { let s = ""; for (const x of it) { if (q.min < q.max || q.min > 5 || q.max < -5) s += typeof x + ":" + (typeof x === "symbol" ? "@" : "" + x) + ";"; if (q.min === q.max) s += "="; if (s.length > 90) break; } return s; }
function pat(it: any, q: Q): string { const [a, b = "none", ...r] = it; return q.min < q.max || q.min === 3 || q.max > 99 ? typeof a + typeof b + r.length : "odd" + a + b + r.length; }
function early(it: any, q: Q, how: string): any { let n = 0; for (const x of it) { if (q.min > 100 || q.max > 100 || q.min === q.max) n++; if (how === "break") break; if (how === "return") return "r" + (typeof x); if (how === "throw") throw how; if (how === "continue") { n++; continue; } n += 2; if (n > 20) break; } return n + how; }
const t = (f: () => any): string => { try { return "" + f(); } catch (e) { return "!" + (typeof e === "string" ? e : (e as Error).constructor.name); } };
const qs: any[] = [{ min: 1, max: 9 }, undefined, null, "text", 5, { max: 1 }, { min: "a", max: "z" }, [1, 2], { min: 3, max: 3 }, { get min() { log.push("m"); return 1; }, max: 2 }];
const make: (() => any)[] = [() => [1, 2, 3].values(), () => new Map([[1, 2]]).entries(), () => new Set([1, 2]).values(), () => "ab"[Symbol.iterator](), () => "aba".matchAll(/a/g), () => (function* () { yield 9; })()];
for (let a = 0; a < make.length; a++) for (let b = 0; b < make.length; b++) { const i = make[a]!(); i.next = Object.getPrototypeOf(make[b]!()).next; for (const q of [qs[0], qs[1], 5]) console.log(a, b, t(() => walk(i, q)), t(() => walk({ [Symbol.iterator]: () => make[a]!() }, q))); }
for (const q of qs) { const shared = [1, 2, 3, 4, 5, 6].values(); console.log(t(() => early(shared, q, "break")), shared.next().value, t(() => early(shared, q, "return")), t(() => walk(shared, q)), shared.next().done, t(() => walk(shared, q))); const m = new Map([[1, 1], [2, 2], [3, 3]]).entries(); console.log(t(() => early(m, q, "break")), t(() => pat(m, q)), m.next().done); }
export {};
