// Flags: --aot-limit=KeyOrdersPerLayout:4
// A class has used up the numbers for its key orders. An object that gets its keys in a further order is refused a number once, not at every store that follows,
// and the objects that get their keys in one order share what holds it, each with as many of the keys as it has.
// COUNT: limit:KeyOrdersPerLayout <= 2150
// COUNT: counter:CompiledStructuresMade <= 800
const names = ["a", "b", "c", "d", "e", "f"]
class Row {
  set(name, value) {
    switch (name) {
      case "a": this.a = value; break
      case "b": this.b = value; break
      case "c": this.c = value; break
      case "d": this.d = value; break
      case "e": this.e = value; break
      case "f": this.f = value; break
    }
    return this
  }
}
function inOrder(order, upTo = order.length) {
  const row = new Row()
  for (let k = 0; k < upTo; k++) row.set(order[k], k)
  return row
}
function show(row) {
  let looped = ""
  for (const key in row) looped += key
  return Object.keys(row).join("") + " " + looped + " " + Reflect.ownKeys(row).join("") + " " + JSON.stringify(row) + " " + Object.keys({ ...row }).join("")
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

for (const order of ["abcdef", "bacdef", "cabdef", "dabcef", "eabcdf"]) console.log(show(inOrder(order)))

// One order, many objects.
let wrong = 0
for (let n = 0; n < 1000; n++) if (Object.keys(inOrder("fedcba")).join("") !== "fedcba") wrong++
console.log(wrong)

// Every order.
const kept = []
for (let n = 0; n < 720; n++) {
  const order = permutation(n), row = inOrder(order)
  if (Object.keys(row).join("") !== order) wrong++
  kept.push(row)
}
for (let n = 0; n < 720; n++) if (Object.keys(kept[n]).join("") !== permutation(n)) wrong++
console.log(wrong)

// Objects that stop on the way, and go on later, the same way or another.
const stopped = []
for (let upTo = 0; upTo <= 6; upTo++) stopped.push(inOrder("fdbeca", upTo))
console.log(stopped.map(show).join("\n"))
const first = inOrder("fdb"), second = inOrder("fdb"), third = inOrder("fdb")
first.set("a", 7)
console.log(show(first), show(second), show(third))
second.set("c", 8).set("a", 9)
console.log(show(first), show(second), show(third))
third.set("a", 10).set("e", 11)
first.set("e", 12)
console.log(show(first), show(second), show(third))
console.log(stopped.map(row => Object.keys(row).join("")).join())

// A key goes and comes back, a key that the class does not know comes between two that it knows, and an object is closed.
const changed = inOrder("fedcba")
delete changed.d
console.log(show(changed))
changed.set("d", 1)
console.log(show(changed), show(inOrder("fedcba")))
const wider = inOrder("fed")
wider["x" + names.length] = 1
wider.set("c", 2)
wider["y" + names.length] = 3
wider.set("b", 4)
console.log(show(wider), show(inOrder("fedcb")))
const closed = Object.freeze(inOrder("fedc"))
try {
  closed.set("b", 1)
} catch (error) {
  console.log(error.constructor.name)
}
console.log(show(closed), Object.isFrozen(closed), show(inOrder("fedcb")), show(Object.assign(new Row(), closed)))

// Objects that share an order get another prototype, or a key that the class does not know, each at one place of the program. Then others take the order further.
const other = { __proto__: Row.prototype }
function moved(row) {
  Object.setPrototypeOf(row, other)
  return row
}
function tagged(row) {
  row["t" + names.length] = 0
  return row
}
for (let upTo = 2; upTo <= 6; upTo++) {
  let line = ""
  for (let times = 0; times < 20; times++) line = [moved(inOrder("ecafdb", upTo)), tagged(inOrder("caebdf", upTo)), tagged(moved(inOrder("aecdbf", upTo))), moved(tagged(inOrder("bfdaec", upTo)))].map(show).join(" ")
  console.log(line)
}
console.log(show(moved(inOrder("ecaf")).set("b", 1)), show(tagged(inOrder("caeb")).set("f", 1)), show(moved(tagged(inOrder("bfda"))).set("c", 1).set("e", 2)), Object.getPrototypeOf(moved(inOrder("ecafd"))) === other)
