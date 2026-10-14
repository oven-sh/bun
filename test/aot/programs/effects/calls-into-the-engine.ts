// Side effects of calls to built-in functions: each line goes wrong if the compiler assumes that a call does less than it does.
let n = 0
const xs = [1, 2, 3]
xs.forEach(() => { n++ })
console.log(n)
n = 10
const doubled = xs.map(x => { n += x; return x * 2 })
console.log(n, doubled[2])
let s = 0
for (let i = 0; i < 5; i++) s += Math.hypot(i, i + 1, i + 2)
console.log(s.toFixed(6))
const a = [3, 1, 2]
const first = a[0]
a.sort()
console.log(first, a[0], a[1], a[2])
const b = [1, 2, 3]
const before = b[0]
b.reverse()
console.log(before, b[0])
b.fill(7)
console.log(b[1])
const where = b.indexOf(7)
b[0] = 8
console.log(where, b.indexOf(7))
const m = new Map<string, number>()
m.set("a", 1)
const one = m.get("a")
m.set("a", 2)
console.log(one, m.get("a"), m.size)
console.log("abc".toUpperCase() + "abc".toUpperCase(), "a-b".split("-").length)
const c = [1, 2]
const length = c.length
c.push(3)
c.pop()
c.pop()
console.log(length, c.length, c.join("+"))
