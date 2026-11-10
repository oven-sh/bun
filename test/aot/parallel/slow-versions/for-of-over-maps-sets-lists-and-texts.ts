interface Q { readonly min: number; readonly max: number }
const log: string[] = [];
function walk(it: any, q: Q): string { let s = ""; for (const x of it) { if (q.min < q.max || q.min > 5 || q.max < -5) s += typeof x + ":" + (typeof x === "symbol" ? "@" : "" + x) + ";"; if (q.min === q.max) s += "="; if (s.length > 90) break; } return s; }
function pat(it: any, q: Q): string { const [a, b = "none", ...r] = it; return q.min < q.max || q.min === 3 || q.max > 99 ? typeof a + typeof b + r.length : "odd" + a + b + r.length; }
function early(it: any, q: Q, how: string): any { let n = 0; for (const x of it) { if (q.min > 100 || q.max > 100 || q.min === q.max) n++; if (how === "break") break; if (how === "return") return "r" + (typeof x); if (how === "throw") throw how; if (how === "continue") { n++; continue; } n += 2; if (n > 20) break; } return n + how; }
const t = (f: () => any): string => { try { return "" + f(); } catch (e) { return "!" + (typeof e === "string" ? e : (e as Error).constructor.name); } };
const qs: any[] = [{ min: 1, max: 9 }, undefined, null, "text", 5, { max: 1 }, { min: "a", max: "z" }, [1, 2], { min: 3, max: 3 }, { get min() { log.push("m"); return 1; }, max: 2 }];
for (const q of qs) console.log("list", t(() => walk([1, 2.5, "a", null], q)), t(() => pat([1, 2.5, "a", null], q)), log.splice(0).join());
for (const q of qs) console.log("holes", t(() => walk([1, , 3], q)), t(() => pat([1, , 3], q)), log.splice(0).join());
for (const q of qs) console.log("map", t(() => walk(new Map<any, any>([["a", 1], ["b", 2]]), q)), t(() => pat(new Map<any, any>([["a", 1], ["b", 2]]), q)), log.splice(0).join());
for (const q of qs) console.log("values", t(() => walk(new Map([["a", 1]]).values(), q)), t(() => pat(new Map([["a", 1]]).values(), q)), log.splice(0).join());
for (const q of qs) console.log("keys", t(() => walk(new Map([[1, "a"]]).keys(), q)), t(() => pat(new Map([[1, "a"]]).keys(), q)), log.splice(0).join());
for (const q of qs) console.log("set", t(() => walk(new Set<any>([1, "x"]), q)), t(() => pat(new Set<any>([1, "x"]), q)), log.splice(0).join());
for (const q of qs) console.log("setentries", t(() => walk(new Set([1]).entries(), q)), t(() => pat(new Set([1]).entries(), q)), log.splice(0).join());
for (const q of qs) console.log("text", t(() => walk("ab\ud83d\ude00c", q)), t(() => pat("ab\ud83d\ude00c", q)), log.splice(0).join());
for (const q of qs) console.log("lone", t(() => walk("\ud800x", q)), t(() => pat("\ud800x", q)), log.splice(0).join());
for (const q of qs) console.log("empty", t(() => walk("", q)), t(() => pat("", q)), log.splice(0).join());
for (const q of qs) console.log("none", t(() => walk([], q)), t(() => pat([], q)), log.splice(0).join());
for (const q of qs) console.log("entries", t(() => walk(["p", "q"].entries(), q)), t(() => pat(["p", "q"].entries(), q)), log.splice(0).join());
for (const q of qs) console.log("view", t(() => walk(new Uint8Array([7, 8]), q)), t(() => pat(new Uint8Array([7, 8]), q)), log.splice(0).join());
for (const q of qs) console.log("args", t(() => walk((function (..._a: any[]) { return arguments; })(1, 2), q)), t(() => pat((function (..._a: any[]) { return arguments; })(1, 2), q)), log.splice(0).join());
for (const q of qs) console.log("gen", t(() => walk((function* () { yield 1; yield 2; })(), q)), t(() => pat((function* () { yield 1; yield 2; })(), q)), log.splice(0).join());
for (const q of qs) console.log("stepped", t(() => walk((() => { const i = [1, 2, 3].values(); i.next(); return i; })(), q)), t(() => pat((() => { const i = [1, 2, 3].values(); i.next(); return i; })(), q)), log.splice(0).join());
for (const q of qs) console.log("ended", t(() => walk((() => { const i = [1].values(); i.next(); i.next(); return i; })(), q)), t(() => pat((() => { const i = [1].values(); i.next(); i.next(); return i; })(), q)), log.splice(0).join());
for (const q of qs) console.log("ownnext", t(() => walk(Object.assign([1, 2].values(), { next: () => ({ done: log.push("n") > 2, value: "own" }) }), q)), t(() => pat(Object.assign([1, 2].values(), { next: () => ({ done: log.push("n") > 2, value: "own" }) }), q)), log.splice(0).join());
for (const q of qs) console.log("crossnext", t(() => walk(Object.assign(new Map([[1, 2]]).entries(), { next: [].values().next }), q)), t(() => pat(Object.assign(new Map([[1, 2]]).entries(), { next: [].values().next }), q)), log.splice(0).join());
for (const q of qs) console.log("getnext", t(() => walk(Object.defineProperty([1].values(), "next", { get() { log.push("G"); return undefined; } }), q)), t(() => pat(Object.defineProperty([1].values(), "next", { get() { log.push("G"); return undefined; } }), q)), log.splice(0).join());
for (const q of qs) console.log("sub", t(() => walk(new (class extends Array<number> {})(1, 2), q)), t(() => pat(new (class extends Array<number> {})(1, 2), q)), log.splice(0).join());
for (const q of qs) console.log("submap", t(() => walk(new (class extends Map<number, number> { *[Symbol.iterator](): any { yield "sm"; } })([[1, 2]]), q)), t(() => pat(new (class extends Map<number, number> { *[Symbol.iterator](): any { yield "sm"; } })([[1, 2]]), q)), log.splice(0).join());
for (const q of qs) console.log("proxy", t(() => walk(new Proxy([1, 2], {}), q)), t(() => pat(new Proxy([1, 2], {}), q)), log.splice(0).join());
for (const q of qs) console.log("proxyit", t(() => walk(({ [Symbol.iterator]: () => new Proxy([1, 2].values(), {}) }), q)), t(() => pat(({ [Symbol.iterator]: () => new Proxy([1, 2].values(), {}) }), q)), log.splice(0).join());
for (const q of qs) console.log("createit", t(() => walk(({ [Symbol.iterator]: () => Object.create([1, 2].values()) }), q)), t(() => pat(({ [Symbol.iterator]: () => Object.create([1, 2].values()) }), q)), log.splice(0).join());
for (const q of qs) console.log("getter", t(() => walk(Object.defineProperty([1, 2, 3], 1, { get() { log.push("g"); return "got"; }, configurable: true }), q)), t(() => pat(Object.defineProperty([1, 2, 3], 1, { get() { log.push("g"); return "got"; }, configurable: true }), q)), log.splice(0).join());
for (const q of qs) console.log("thrower", t(() => walk(Object.defineProperty([1, 2, 3], 1, { get() { throw new RangeError("el"); }, configurable: true }), q)), t(() => pat(Object.defineProperty([1, 2, 3], 1, { get() { throw new RangeError("el"); }, configurable: true }), q)), log.splice(0).join());
for (const q of qs) console.log("shrinks", t(() => walk((() => { const l: any[] = [1, 2, 3, 4]; Object.defineProperty(l, 1, { get() { l.length = 2; return "s"; }, configurable: true }); return l; })(), q)), t(() => pat((() => { const l: any[] = [1, 2, 3, 4]; Object.defineProperty(l, 1, { get() { l.length = 2; return "s"; }, configurable: true }); return l; })(), q)), log.splice(0).join());
for (const q of qs) console.log("closing", t(() => walk(({ [Symbol.iterator]: () => { let given = 0; return { next: () => ({ done: given++ >= 5, value: 1 }), return() { log.push("ret"); return {}; } }; } }), q)), t(() => pat(({ [Symbol.iterator]: () => { let given = 0; return { next: () => ({ done: given++ >= 5, value: 1 }), return() { log.push("ret"); return {}; } }; } }), q)), log.splice(0).join());
for (const q of qs) console.log("badreturn", t(() => walk(({ [Symbol.iterator]: () => { let given = 0; return { next: () => ({ done: given++ >= 5, value: 1 }), return: () => 5 }; } }), q)), t(() => pat(({ [Symbol.iterator]: () => { let given = 0; return { next: () => ({ done: given++ >= 5, value: 1 }), return: () => 5 }; } }), q)), log.splice(0).join());
for (const q of qs) console.log("badresult", t(() => walk(({ [Symbol.iterator]: () => ({ next: () => 5 }) }), q)), t(() => pat(({ [Symbol.iterator]: () => ({ next: () => 5 }) }), q)), log.splice(0).join());
for (const q of qs) console.log("helper", t(() => walk([1, 2].values().map(x => x * 2), q)), t(() => pat([1, 2].values().map(x => x * 2), q)), log.splice(0).join());
for (const q of qs) console.log("boxed", t(() => walk(Object("xy"), q)), t(() => pat(Object("xy"), q)), log.splice(0).join());
for (const q of qs) console.log("nul", t(() => walk(null, q)), t(() => pat(null, q)), log.splice(0).join());
for (const q of qs) console.log("undef", t(() => walk(undefined, q)), t(() => pat(undefined, q)), log.splice(0).join());
for (const q of qs) console.log("num", t(() => walk(5, q)), t(() => pat(5, q)), log.splice(0).join());
for (const q of qs) console.log("obj", t(() => walk({}, q)), t(() => pat({}, q)), log.splice(0).join());
export {};
