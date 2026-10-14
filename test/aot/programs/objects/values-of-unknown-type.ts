// Values of unknown type: objects created by built-in functions, accessed by name, by computed key and through methods.
const o: any = JSON.parse('{"a":1,"b":2.5,"c":"x","d":{"e":[1,2,3]},"f":null}')
console.log(o.a, o.b, o.c, o.d.e[1], o.f, o.g, o.d.e.length)
o.a = 10
o.g = "new"
o.d.e[1] = 20
console.log(o.a, o.g, o.d.e[1], o["a"], o["d"]["e"][2])
const list: any[] = JSON.parse('[{"k":1,"v":"a"},{"k":2,"v":"b"},{"v":"c","k":3},{"k":4}]')
let sum = 0
let text = ""
for (let round = 0; round < 1000; round++) {
  for (let i = 0; i < list.length; i++) {
    sum += list[i].k
    if (round === 0) text += list[i].v
  }
}
console.log(sum, text)
const s: any = JSON.parse('"hello"')
console.log(s.length, s.toUpperCase(), s.charCodeAt(1), s[0])
const keys: any = Object.keys(o)
console.log(keys.join(","), keys.length)
let caught = ""
const n: any = JSON.parse("null")
console.log(typeof n, n === null)
const m: any = new Map([["x", 1]])
console.log(m.get("x"), m.size, m.has("y"))
for (let i = 0; i < 100; i++) o["p" + (i % 5)] = i
console.log(o.p0, o.p4, Object.keys(o).length)
