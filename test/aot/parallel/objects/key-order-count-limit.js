// Own keys stay in creation order when instances of one class use more key orders than a layout can number.
// COUNTER: KeyOrderLimit >= 4465
// COUNTER: KeyOrderLimit <= 4600
// COUNTER: DeleteOfRequiredField = 0
// COUNTER: NoExtraPropertiesWord = 0
// COUNTER: StoreOfOtherType = 0
const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i"]
class Query {
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
      case "i": this.i = value; break
    }
  }
  sum() { return this.a + this.b + this.c + this.d + this.e + this.f + this.g + this.h + this.i }
}
function permutation(index) { const left = names.slice(), result = []; for (let n = 9, radix = 40320; n > 0; n--) { result.push(left.splice(Math.floor(index / radix), 1)[0]); index %= radix; if (n > 1) radix /= n - 1 } return result }
function build(n) {
  const order = permutation((n * 11) % 362880), query = new Query()
  for (let k = 0; k < 9; k++) {
    if (n % 2 === 1) query[order[k]] = k + 1
    else query.set(order[k], k + 1)
  }
  return [query, order.join("")]
}
function check(from, to) {
  let wrong = 0, firstWrong = "", sums = 0
  for (let n = from; n < to; n++) {
    const [query, order] = build(n), keys = Object.keys(query).join("")
    if (keys !== order) {
      if (wrong === 0) firstWrong = n + " " + keys + " " + order
      wrong++
    }
    sums += query.sum()
  }
  return wrong + " " + firstWrong + " " + sums
}
console.log(check(0, 70000))
console.log(check(0, 20000))
console.log(check(70000, 70005))

for (const n of [0, 1, 65000, 69998, 69999, 70004]) {
  const [query, order] = build(n)
  let enumerated = ""
  for (const key in query) enumerated += key
  console.log(n, order, enumerated, Object.keys({ ...query }).join(""), Reflect.ownKeys(query).join(""), Object.entries(query).map(e => e.join("")).join(""), JSON.stringify(query))
  delete query.e
  query.e = 0
  query.extra = 1
  console.log(Object.keys(query).join(), query.sum())
}

const partial = new Query()
partial.set("h", 1)
partial.c = 2
partial["a"] = 3
console.log(Object.keys(partial).join(), partial.sum())
