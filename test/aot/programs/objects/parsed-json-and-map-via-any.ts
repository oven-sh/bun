// An object made by `JSON.parse` and a Map, both used through `any`.
const o: any = JSON.parse('{"a":1,"b":2.5,"c":"x","d":{"e":[1,2,3]},"f":null}')
const m: any = new Map([["x", 1]])
console.log(m.get("x"), m.size, m.has("y"))
for (let i = 0; i < 100; i++) o["p" + (i % 5)] = i
console.log(o.p0, o.p4, Object.keys(o).length)
