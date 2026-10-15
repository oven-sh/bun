// A generic function returns a copy of its argument with members added. Nothing else in the program touches the types.
interface Base { name: string; size?: number; tags?: string[]; note?: string }
function row(name: string, f: () => unknown) { try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": " + "threw " + (e instanceof TypeError ? "TypeError" : String(e))) } }
function copy<R extends Base>(value: R): R { return { ...value } }
function copyAndAdd<R extends Base>(value: R): R { return { ...value, added: true as const } }
function copyAndMaybe<R extends Base>(value: R, on: boolean): R { return { ...value, ...(on && { maybe: true }) } }
function on(): boolean { return Date.now() > 0 }
const one = { name: "one", size: 1.5, extra: "e" }
const either = { name: "either", ...(on() ? { size: 2.5 } : { note: "n", tags: ["t"] }) }
row("one record, a copy", () => { const r = copy(one); return r.name + r.size + r.extra + (r === one) })
row("one record, a member more", () => { const r = copyAndAdd(one); return r.name + r.size + r.extra + Object.keys(r).join() })
row("one record, maybe a member more", () => { const r = copyAndMaybe(one, true); return r.name + r.extra + Object.keys(r).join() })
row("a union, a copy", () => { const r = copy(either); return r.name + ("size" in r ? r.size : r.note) })
row("a union, a member more", () => { const r = copyAndAdd(either); return r.name + ("size" in r ? r.size : r.note) + Object.keys(r).join() })
row("a union, maybe a member more", () => { const r = copyAndMaybe(either, true); return r.name + ("size" in r ? r.size : r.note) + Object.keys(r).join() })
