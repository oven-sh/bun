// `map` and `join` on a small array literal.
const xs = [1, 2, 3]
const d = xs.map(x => x * 2)
console.log(d[2], d.length, d[0] + d[1], d.join(","))
const e = xs.map(x => x + 0.5)
console.log(e[2], e.length, e.join(","))
const f = xs.filter(x => x > 1)
console.log(f[1], f.length)
const g = xs.slice(1)
console.log(g[0], g[1], g[2])
const h = xs.concat([4.5])
console.log(h[0], h[3])
