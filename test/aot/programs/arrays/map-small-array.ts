// `map` on a small array literal, with one element read.
const xs = [1, 2, 3]
const d = xs.map(x => x * 2)
const v = d[2]
console.log(typeof v, v === undefined, v === 6, v == null)
let t = 0
for (let i = 0; i < d.length; i++) t += d[i]
console.log(t)
console.log(d[2]!)
console.log(String(d[1]))
