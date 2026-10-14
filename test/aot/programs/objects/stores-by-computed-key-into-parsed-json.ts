// Objects: stores by computed key into parsed JSON.
const o: any = JSON.parse('{"a":1}')
for (let i = 0; i < 12; i++) { o["p" + (i % 5)] = i; console.log(i, o.p0) }
