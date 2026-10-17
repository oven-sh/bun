// Built-in functions that only inspect their arguments: what they print is right, and the arguments need not escape.
class Point { constructor(public x: number, public y: number, public on: boolean, public tag: string | null = null) {} }
const p = new Point(1, 2.5, true)
const q = new Point(-3, 4, false, "q")
console.log(JSON.stringify(p), JSON.stringify([p, q]), JSON.stringify({ p, list: [1, 2], deep: { q, flag: false } }))
console.log(Object.keys(p).join(), Object.values(q).join(), Object.entries(p).map(([k, v]) => k + "=" + v).join("&"))
const record = { id: 7, ok: true, name: "r", inner: { n: 0.5, none: null, missing: undefined }, items: [true, false] }
console.log(JSON.stringify(record), Object.keys(record.inner).length, typeof Object.values(record)[1], Object.values(record.items).join())
let sum = 0
for (let i = 0; i < 3; i++) { p.x += i; sum += p.x + q.y }
console.log(sum, p.x, p.on === true, q.on === false)
