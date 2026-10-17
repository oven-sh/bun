// Numbers as keys of Maps and Sets and as array indices: -0 is the key 0, and whole-number doubles equal integers.
const ks: number[] = ["0", "-0", "1", "-1", "7", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967295", "4294967296", "0.5", "-0.5", "1e21", "NaN", "Infinity", "-Infinity", "5e-324"].map(Number)
const m = new Map<number, string>(), s = new Set<number>()
const put = (k: number, v: string) => { m.set(k, v); s.add(k) }
const got = (k: number) => m.get(k) + "/" + m.has(k) + "/" + s.has(k)
ks.forEach((k, i) => put(k, "v" + i))
console.log(m.size, s.size, ks.map(got).join(" "))
console.log([...m.keys()].map(k => Object.is(k, -0) ? "-0" : String(k)).join(), [...s].map(k => Object.is(k, -0) ? "-0" : String(k)).join())
const half = (k: number) => k / 2
console.log(got(half(2)), got(half(0)), got(half(-0)), got(half(1)), got(half(14)), got(half(3)), got(0 / 0), got(-(0 / 0)))
const loose: any = m
console.log(loose.get(0), loose.get(-0), loose.get(1), loose.get(2147483648), loose.get(NaN), loose.get(0.5), loose.get("1"))
console.log(m.delete(half(-0)), m.has(0), m.delete(half(2)), m.has(1), m.delete(half(5)), m.size)
const a: string[] = ["a", "b", "c"]
const at = (k: number) => String(a[k])
console.log(ks.map(at).join(), at(half(2)), at(half(4)), at(half(-0)), at(half(1)), at(half(6)))
const set = (k: number, v: string) => { a[k] = v }
set(half(2), "B"); set(half(-0), "A"); set(half(8), "E"); set(half(1), "fraction"); set(-1, "minus")
console.log(a.join(), a.length, Object.keys(a).join())
