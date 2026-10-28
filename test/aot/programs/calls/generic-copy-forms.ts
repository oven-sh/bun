// A generic function returns a copy of its argument with members added: `{ ...value, added: true }` under the type parameter. The copy is what the caller's type says, as the argument was.
interface Base { name: string; size?: number; tags?: string[]; note?: string }
function row(name: string, f: () => unknown) { try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": threw " + (e instanceof TypeError ? "TypeError" : String(e))) } }
function copy<R extends Base>(value: R): R { return { ...value } }
function copyAndAdd<R extends Base>(value: R): R { return { ...value, added: true as const } }
function copyAndMaybe<R extends Base>(value: R, on: boolean): R { return { ...value, ...(on && { maybe: true }) } }
function copyAndReplace<R extends Base>(value: R, name: string): R { return { ...value, name } }
function copyOfTwo<R extends Base>(value: R, more: { note: string }): R { return { ...value, ...more, last: 1.5 } }
const arrow = <R extends Base>(value: R): R => ({ ...value, arrow: "a" })
function on(): boolean { return Date.now() > 0 }
const one = { name: "one", size: 1.5, extra: "e" }
const either = { name: "either", ...(on() ? { size: 2.5 } : { note: "n", tags: ["t"] }) }
row("one record, a copy", () => { const r = copy(one); return r.name + r.size + r.extra + (r === one) })
row("one record, a member more", () => { const r = copyAndAdd(one); return r.name + r.size + r.extra + Object.keys(r).join() + (r === one) + JSON.stringify(one) })
row("one record, maybe a member more", () => { const r = copyAndMaybe(one, true); return r.name + r.extra + Object.keys(r).join() + Object.keys(copyAndMaybe(one, false)).join() })
row("one record, a member replaced", () => { const r = copyAndReplace(one, "other"); return r.name + r.size + r.extra + Object.keys(r).join() + one.name })
row("one record, two spreads", () => { const r = copyOfTwo(one, { note: "noted" }); return r.name + (r as Base).note + r.extra + Object.keys(r).join() })
row("one record, an arrow function", () => { const r = arrow(one); return r.name + r.extra + Object.keys(r).join() })
row("a union, a copy", () => { const r = copy(either); return r.name + ("size" in r ? r.size : r.note) })
row("a union, a member more", () => { const r = copyAndAdd(either); return r.name + ("size" in r ? r.size : r.note) + Object.keys(r).join() })
row("a union, maybe a member more", () => { const r = copyAndMaybe(either, true); return r.name + ("size" in r ? r.size : r.note) + Object.keys(r).join() })
row("the order of evaluation", () => { const log: string[] = []; const source = { get name() { log.push("read"); return "g" } }; function tell<R extends Base>(value: R): R { return { ...value, told: (log.push("told"), 1) } } const r = tell(source); return r.name + log.join() })
interface Wide { name: string; kind: "command"; a1?: string; a2?: number; a3?: boolean; a4?: string[]; a5?: string; a6?: number; a7?: boolean; a8?: string[]; a9?: string; a10?: number; a11?: boolean; a12?: string[] }
function register<R extends Wide>(command: R, flag: boolean): R { return { ...command, registered: true as const, ...(flag && { flagged: true }) } }
const command = { name: "first", kind: "command" as const, a2: 1.5, a4: ["x"], ...(on() ? { a1: "on", a6: 2.5 } : { a5: "off", a7: true, a8: ["y"], a9: "s", a10: 3.5, a11: false, a12: ["z"] }) }
row("a wide union, registered", () => { const r = register(command, true); return r.name + r.kind + r.a2 + r.a4.join() + ("a1" in r ? r.a1 : r.a5) + Object.keys(r).join() })
let total = 0
for (let i = 0; i < 2000; i++) total += copyAndAdd({ name: "n" + i, size: i }).size
console.log("in a loop: " + total)
