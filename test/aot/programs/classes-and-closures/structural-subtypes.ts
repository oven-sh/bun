// Object types that merely fit a union structurally, without being declared members of it.
interface T { bs: number; cs: string; o: number[] }
interface U { bs?: number; cs: string }
const readU = (u: U) => u.bs
const addU = (u: U, x: number) => { u.bs = (u.bs ?? 0) + x; return u.bs }
const hasU = (u: U) => ("bs" in u) + " " + Object.keys(u).join() + " " + (u.bs === undefined) + " " + (u.bs === 4)
const call: any = { readU, addU, hasU }
const ts: T[] = []
for (let i = 0; i < 3; i++) ts.push({ bs: i + 0.5, cs: "t" + i, o: [i] })
const us: U[] = [{ cs: "u0" }, { cs: "u1", bs: 7 }]
const sum = (list: T[]) => { let s = 0; for (const t of list) s += t.bs; return s }
console.log("typed:", sum(ts), us.map(readU).join(), us.map(hasU).join(" | "))
console.log("a T through any:", ts.map(t => call.readU(t)).join(), ts.map(t => call.hasU(t)).join(" | "))
console.log("stored through U:", ts.map(t => call.addU(t, 3.5)).join(), sum(ts), ts.map(t => t.bs).join(), call.hasU(ts[0]))
console.log("a U through any:", us.map(u => call.addU(u, 1)).join(), us.map(hasU).join(" | "))
console.log("plain data through any:", call.readU({ cs: "p" }), call.readU({ cs: "p", bs: 2 }), call.addU({ cs: "p" }, 2), call.hasU({ cs: "p", bs: 4, more: 1 }))
