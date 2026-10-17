// Stores by computed keys into an object made by `JSON.parse`.
const o: any = JSON.parse('{"a":1}')
for (let i = 0; i < 12; i++) { o["p" + (i % 5)] = i; console.log(i, o.p0) }
