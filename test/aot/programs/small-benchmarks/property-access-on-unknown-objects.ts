// Property reads and stores by name on objects of unknown type.
let json = "["
for (let i = 0; i < 1000; i++) json += (i ? "," : "") + '{"k":' + i + ',"v":"s' + i + '","w":' + i + '.5}'
json += "]"
const list: any[] = JSON.parse(json)
let sum = 0
const start = performance.now()
for (let round = 0; round < 5000; round++) {
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    sum += item.k + item.w
    item.k = item.k + 1
  }
}
console.log(sum, Math.round(performance.now() - start) + "ms")
