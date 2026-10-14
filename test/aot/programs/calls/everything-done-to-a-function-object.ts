// Everything that can be done to a function object (properties added and deleted, index keys, freezing, another prototype), each followed by a garbage collection and a call.
const g: any = globalThis
function collect(): void { if (typeof g.gc === "function") g.gc(); else if (g.Bun) g.Bun.gc(true) }
function snapshot(): void { if (typeof g.generateHeapSnapshot === "function") g.generateHeapSnapshot() }
const special = new Set<string>(["length", "name", "prototype", "arguments", "caller"])
function own(f: any): string { return Reflect.ownKeys(f).filter(k => typeof k === "symbol" || !special.has(k)).map(k => String(k)).join(",") }
function attempt(what: () => unknown): string { try { return String(what()) } catch (e) { return (e as Error).constructor.name } }
function make(k: number): Array<(x: number) => number> { return [x => x + k, function (x: number): number { return x * k }, x => x, function (x: number): number { return x - 1 }] }
let row = 0
function check(name: string, fs: Array<(x: number) => number>, extra: string): void {
    collect()
    console.log(++row, name, fs.map(f => f(10)).join(" "), extra)
}
const sym = Symbol("s")

{ const fs = make(3); check("as made", fs, fs.map(own).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) f.a = 1; check("one property", fs, (fs as any[]).map(f => f.a + ":" + own(f)).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) { f.a = 1; f.b = 2; f.c = 3; f.d = 4; f.e = 5 } check("a run of properties", fs, (fs as any[]).map(f => f.a + f.e + ":" + own(f)).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) { for (let i = 0; i < 300; i++) f["p" + i] = i; for (let i = 0; i < 300; i += 2) delete f["p" + i] } check("many, half deleted", fs, (fs as any[]).map(f => Object.keys(f).length + ":" + f.p299 + ":" + f.p298).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) { f.a = 1; delete f.a; collect(); f.b = 2 } check("given, deleted, given", fs, fs.map(own).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) { f[0] = "z"; f[5] = 1 } check("indexed", fs, (fs as any[]).map(f => f[0] + f[5] + ":" + own(f)).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) { f[100000] = 2; f[1] = 1 } check("sparse", fs, (fs as any[]).map(f => f[100000] + ":" + own(f)).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) f[sym] = 7; check("a symbol", fs, (fs as any[]).map(f => f[sym] + ":" + own(f)).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) Object.defineProperty(f, "acc", { get() { return this(1) }, configurable: true }); check("an accessor", fs, (fs as any[]).map(f => f.acc + ":" + own(f) + ":" + Object.keys(f).length).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) Object.defineProperty(f, 2, { value: "i", enumerable: false }); check("an indexed property defined", fs, (fs as any[]).map(f => f[2] + ":" + own(f) + ":" + Object.keys(f).length).join("|")) }
{ const fs = make(3); for (const f of fs) Object.freeze(f); check("frozen", fs, (fs as any[]).map(f => Object.isFrozen(f) + ":" + attempt(() => { f.a = 1 }) + ":" + own(f)).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) { f.a = 1; Object.freeze(f) } check("given, frozen", fs, (fs as any[]).map(f => attempt(() => { f.a = 2 }) + ":" + f.a).join("|")) }
{ const fs = make(3); for (const f of fs) Object.seal(f); check("sealed", fs, (fs as any[]).map(f => Object.isSealed(f) + ":" + attempt(() => { f.a = 1 })).join("|")) }
{ const fs = make(3); for (const f of fs) Object.preventExtensions(f); check("not extensible", fs, (fs as any[]).map(f => Object.isExtensible(f) + ":" + attempt(() => { f[0] = 1 })).join("|")) }
{ const fs = make(3); const proto = { inherited: 5 }; for (const f of fs) Object.setPrototypeOf(f, proto); check("another prototype", fs, (fs as any[]).map(f => f.inherited + ":" + typeof f.call + ":" + Function.prototype.call.call(f, undefined, 4)).join("|")) }
{ const fs = make(3); for (const f of fs) Object.setPrototypeOf(f, null); check("no prototype", fs, (fs as any[]).map(f => String(Object.getPrototypeOf(f)) + ":" + typeof f).join("|")) }
{ const fs = make(3); const os = (fs as any[]).map(f => { f.a = 9; return Object.create(f) }); check("as a prototype", fs, os.map(o => o.a + ":" + typeof o + ":" + attempt(() => o(1))).join("|")) }
{ const fs = make(3); const os = (fs as any[]).map(f => Object.create(f)); for (const f of fs as any[]) f.late = 1; check("a prototype first, given later", fs, os.map(o => o.late).join("|")) }
{ const fs = make(3); for (const f of fs) Object.assign(f, { p: 1, q: 2 }); check("Object.assign onto", fs, (fs as any[]).map(f => own(f) + ":" + JSON.stringify(Object.assign({}, f)) + JSON.stringify({ ...f })).join("|")) }
{ const fs = make(3); check("spread and assign from one as made", fs, (fs as any[]).map(f => JSON.stringify({ ...f }) + JSON.stringify(Object.assign({}, f)) + Object.entries(f).length + Object.values(f).length).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) { f.x = 1; f.y = 2 } check("for in", fs, (fs as any[]).map(f => { let s = ""; for (const k in f) s += k; return s }).join("|")) }
{ const fs = make(3); check("for in, as made", fs, (fs as any[]).map(f => { let s = "-"; for (const k in f) s += k; return s }).join("|")) }
{ const fs = make(3); check("JSON", fs, (fs as any[]).map(f => String(JSON.stringify(f)) + JSON.stringify({ f }) + JSON.stringify([f])).join("|")) }
{ const fs = make(3); for (const f of fs) { try { g.structuredClone?.(f) } catch { } } check("structuredClone", fs, "") }
{ const fs = make(3); const w = new WeakMap<object, number>(), m = new Map<unknown, number>(), s = new WeakSet<object>(); fs.forEach((f, i) => { w.set(f, i); m.set(f, i); s.add(f) }); check("as keys", fs, fs.map(f => "" + w.get(f) + m.get(f) + s.has(f)).join("|")) }
{ const fs = make(3); const bs = fs.map(f => f.bind(null, 20)); check("bound", fs, bs.map(b => (b as any)() + ":" + b.length).join("|")) }
{ const fs = make(3); check("name and length", fs, fs.map(f => JSON.stringify(f.name) + f.length + typeof (f as any).prototype).join("|")) }
{ const fs = make(3); for (const f of fs) { Object.defineProperty(f, "length", { value: 7 }); Object.defineProperty(f, "name", { value: "n" }) } check("name and length defined", fs, fs.map(f => f.name + f.length + ":" + own(f)).join("|")) }
{ const fs = make(3); check("length stored to", fs, (fs as any[]).map(f => attempt(() => { f.length = 5 }) + f.length).join("|")) }
{ const fs = make(3); check("push onto", fs, (fs as any[]).map(f => attempt(() => Array.prototype.push.call(f, 1, 2)) + ":" + own(f)).join("|")) }
{ const fs = make(3); check("constructed", fs, (fs as any[]).map(f => attempt(() => typeof new f(1))).join("|")) }
{ const fs = make(3); for (const f of fs as any[]) if (f.prototype) f.prototype.m = 1; check("its prototype property given to", fs, (fs as any[]).map(f => f.prototype ? new f(1).m : "-").join("|")) }
{ const fs = make(3); for (const f of fs as any[]) f.prototype = { z: 1 }; check("its prototype property stored to", fs, (fs as any[]).map(f => f.prototype.z + ":" + own(f)).join("|")) }
{ const fs = make(3); check("descriptors", fs, (fs as any[]).map(f => Object.keys(Object.getOwnPropertyDescriptors(f)).filter(k => !special.has(k)).length + ":" + String(Object.getOwnPropertyDescriptor(f, "a")) + String(Object.getOwnPropertyDescriptor(f, 0))).join("|")) }
{ const fs = make(3); check("has", fs, (fs as any[]).map(f => ("a" in f) + ":" + (0 in f) + ":" + Object.hasOwn(f, "a") + ":" + f.hasOwnProperty(3) + ":" + f.propertyIsEnumerable("a")).join("|")) }
{ const fs = make(3); check("reads of what is not there", fs, (fs as any[]).map(f => String(f.a) + String(f[0]) + String(f[sym]) + String(f[-1]) + String(f[1.5])).join("|")) }
{ const fs = make(3); check("as a callback", fs, fs.map(f => [1, 2, 3].map(f).join("") + Array.from({ length: 2 }, (_, i) => f(i)).join("")).join("|")) }
{ const fs = make(3); check("apply, call, Reflect.apply", fs, fs.map(f => "" + f.apply(null, [1]) + f.call(null, 2) + Reflect.apply(f, undefined, [3])).join("|")) }
{ const fs = make(3); const ps = fs.map(f => new Proxy(f, {})); check("behind a proxy", fs, ps.map(p => p(5) + ":" + typeof p).join("|")) }

// Many, some given storage, with collections while they are made.
{
    const kept: Array<(x: number) => number> = []
    let sum = 0
    for (let i = 0; i < 60000; i++) {
        const fs = make(i & 7)
        const f = fs[i & 3] as any
        if (i % 7 === 0) f.tag = i
        if (i % 11 === 0) f[i & 15] = i
        if (i % 13 === 0) Object.freeze(f)
        if (i % 97 === 0) kept.push(f)
        if (i % 20000 === 0) collect()
        sum += f(i & 31)
    }
    snapshot()
    collect()
    console.log(++row, "many", sum, kept.length, kept.reduce((a, f) => a + f(1) + ((f as any).tag ?? 0), 0))
}
snapshot()
console.log("done")
export {}
