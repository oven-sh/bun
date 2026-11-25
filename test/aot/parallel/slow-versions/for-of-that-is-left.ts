interface Q { readonly min: number; readonly max: number }
const log: string[] = [];
function walk(it: any, q: Q): string { let s = ""; for (const x of it) { if (q.min < q.max || q.min > 5 || q.max < -5) s += typeof x + ":" + (typeof x === "symbol" ? "@" : "" + x) + ";"; if (q.min === q.max) s += "="; if (s.length > 90) break; } return s; }
function pat(it: any, q: Q): string { const [a, b = "none", ...r] = it; return q.min < q.max || q.min === 3 || q.max > 99 ? typeof a + typeof b + r.length : "odd" + a + b + r.length; }
function early(it: any, q: Q, how: string): any { let n = 0; for (const x of it) { if (q.min > 100 || q.max > 100 || q.min === q.max) n++; if (how === "break") break; if (how === "return") return "r" + (typeof x); if (how === "throw") throw how; if (how === "continue") { n++; continue; } n += 2; if (n > 20) break; } return n + how; }
const t = (f: () => any): string => { try { return "" + f(); } catch (e) { return "!" + (typeof e === "string" ? e : (e as Error).constructor.name); } };
const qs: any[] = [{ min: 1, max: 9 }, undefined, null, "text", 5, { max: 1 }, { min: "a", max: "z" }, [1, 2], { min: 3, max: 3 }, { get min() { log.push("m"); return 1; }, max: 2 }];
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("list", how, t(() => early([1, 2.5, "a", null], q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("holes", how, t(() => early([1, , 3], q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("map", how, t(() => early(new Map<any, any>([["a", 1], ["b", 2]]), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("values", how, t(() => early(new Map([["a", 1]]).values(), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("keys", how, t(() => early(new Map([[1, "a"]]).keys(), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("set", how, t(() => early(new Set<any>([1, "x"]), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("setentries", how, t(() => early(new Set([1]).entries(), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("text", how, t(() => early("ab\ud83d\ude00c", q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("lone", how, t(() => early("\ud800x", q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("empty", how, t(() => early("", q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("none", how, t(() => early([], q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("entries", how, t(() => early(["p", "q"].entries(), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("view", how, t(() => early(new Uint8Array([7, 8]), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("args", how, t(() => early((function (..._a: any[]) { return arguments; })(1, 2), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("gen", how, t(() => early((function* () { yield 1; yield 2; })(), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("stepped", how, t(() => early((() => { const i = [1, 2, 3].values(); i.next(); return i; })(), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("ended", how, t(() => early((() => { const i = [1].values(); i.next(); i.next(); return i; })(), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("ownnext", how, t(() => early(Object.assign([1, 2].values(), { next: () => ({ done: log.push("n") > 2, value: "own" }) }), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("crossnext", how, t(() => early(Object.assign(new Map([[1, 2]]).entries(), { next: [].values().next }), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("getnext", how, t(() => early(Object.defineProperty([1].values(), "next", { get() { log.push("G"); return undefined; } }), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("sub", how, t(() => early(new (class extends Array<number> {})(1, 2), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("submap", how, t(() => early(new (class extends Map<number, number> { *[Symbol.iterator](): any { yield "sm"; } })([[1, 2]]), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("proxy", how, t(() => early(new Proxy([1, 2], {}), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("proxyit", how, t(() => early(({ [Symbol.iterator]: () => new Proxy([1, 2].values(), {}) }), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("createit", how, t(() => early(({ [Symbol.iterator]: () => Object.create([1, 2].values()) }), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("getter", how, t(() => early(Object.defineProperty([1, 2, 3], 1, { get() { log.push("g"); return "got"; }, configurable: true }), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("thrower", how, t(() => early(Object.defineProperty([1, 2, 3], 1, { get() { throw new RangeError("el"); }, configurable: true }), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("shrinks", how, t(() => early((() => { const l: any[] = [1, 2, 3, 4]; Object.defineProperty(l, 1, { get() { l.length = 2; return "s"; }, configurable: true }); return l; })(), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("closing", how, t(() => early(({ [Symbol.iterator]: () => { let given = 0; return { next: () => ({ done: given++ >= 5, value: 1 }), return() { log.push("ret"); return {}; } }; } }), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("badreturn", how, t(() => early(({ [Symbol.iterator]: () => { let given = 0; return { next: () => ({ done: given++ >= 5, value: 1 }), return: () => 5 }; } }), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("badresult", how, t(() => early(({ [Symbol.iterator]: () => ({ next: () => 5 }) }), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("helper", how, t(() => early([1, 2].values().map(x => x * 2), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("boxed", how, t(() => early(Object("xy"), q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("nul", how, t(() => early(null, q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("undef", how, t(() => early(undefined, q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("num", how, t(() => early(5, q, how)), log.splice(0).join());
for (const q of qs) for (const how of ["break", "return", "throw", "continue", "end"]) console.log("obj", how, t(() => early({}, q, how)), log.splice(0).join());
export {};
