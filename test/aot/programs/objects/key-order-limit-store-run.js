// Adjacent stores that create two fields keep both once instances of the class use every key order a layout can number.
// COUNTER: KeyOrderLimit >= 201
const names = ["a", "b", "c", "d", "e", "f", "g", "h"]
class Entry {
  set(name, value) {
    switch (name) {
      case "a": this.a = value; break
      case "b": this.b = value; break
      case "c": this.c = value; break
      case "d": this.d = value; break
      case "e": this.e = value; break
      case "f": this.f = value; break
      case "g": this.g = value; break
      case "h": this.h = value; break
    }
  }
  finish(y, z) {
    this.y = y
    this.z = z
  }
}
function permutation(index) { const left = names.slice(), result = []; for (let n = 8, radix = 5040; n > 0; n--) { result.push(left.splice(Math.floor(index / radix), 1)[0]); index %= radix; if (n > 1) radix /= n - 1 } return result }
function build(index) {
  const order = permutation(index), entry = new Entry()
  for (let k = 0; k < 8; k++) entry.set(order[k], k)
  return [entry, order.join("")]
}

for (let index = 0; index < 40320; index++) build(index)

let wrong = 0, firstWrong = ""
for (let index = 0; index < 200; index++) {
  const [entry, order] = build(index)
  entry.finish(index, { index })
  const keys = Object.keys(entry).join("")
  if (keys !== order + "yz" || entry.y !== index || entry.z?.index !== index) {
    if (wrong === 0) firstWrong = index + " " + keys
    wrong++
  }
}
console.log(wrong, firstWrong)

const [entry, order] = build(7)
entry.finish("y", "z")
console.log(order, "y" in entry, "z" in entry, JSON.stringify(entry))
