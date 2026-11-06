// Flags: --aot-limit=KeyOrdersPerLayout:4
// Objects of one class get their keys in thousands of orders and are dropped at once. A small collection frees what held those orders, and the same orders list their keys rightly afterwards.
const { edenGC, heapStats } = require("bun:jsc")
const names = ["a", "b", "c", "d", "e", "f", "g"]
class Row {
  set(name, value) {
    switch (name) {
      case "a": this.a = value; break
      case "b": this.b = value; break
      case "c": this.c = value; break
      case "d": this.d = value; break
      case "e": this.e = value; break
      case "f": this.f = value; break
      case "g": this.g = value; break
    }
  }
}
function permutation(index) {
  const left = names.slice()
  let order = ""
  for (let size = left.length; size > 0; size--) {
    order += left.splice(index % size, 1)[0]
    index = Math.floor(index / size)
  }
  return order
}
function wrongAmong(from, to) {
  let wrong = 0
  for (let index = from; index < to; index++) {
    const order = permutation(index), row = new Row()
    for (let k = 0; k < order.length; k++) row.set(order[k], k)
    if (Object.keys(row).join("") !== order) wrong++
  }
  return wrong
}
const structures = () => heapStats().objectTypeCounts.Structure ?? 0

wrongAmong(0, 8)
edenGC()
const before = structures()
const kept = new Row()
for (const name of "gfedcba") kept.set(name, 1)
console.log("wrong", wrongAmong(0, 5040))
edenGC()
const left = structures() - before
console.log(left < 500 ? "the orders of dropped objects are gone" : "left behind: " + left)
console.log(Object.keys(kept).join(""), JSON.stringify(kept))
console.log("wrong", wrongAmong(0, 5040))
edenGC()
kept.set("a", 2)
console.log(Object.keys(kept).join(""), JSON.stringify(kept), Object.keys({ ...kept }).join(""))
