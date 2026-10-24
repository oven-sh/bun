// A hundred stores by computed keys into an object made by `JSON.parse`.
const o: any = JSON.parse('{"a":1,"b":2.5,"c":"x","d":{"e":[1,2,3]},"f":null}')
for (let i = 0; i < 100; i++) { console.log(i); o["p" + (i % 5)] = i }
console.log(o.p0, o.p4, Object.keys(o).length)
