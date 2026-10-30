// Own keys stay in creation order when one object gets more keys than a key order can hold.
// COUNTER: KeyOrderLimit >= 1
// COUNTER: DeleteOfRequiredField = 0
// COUNTER: NoExtraPropertiesWord = 0
class Bag { constructor() { this.first = 0 } mark(value) { this.late = value } unmark() { delete this.late } total() { return this.first + (this.late ?? 0) } }
function countDifferences(object, expected) { const keys = Object.keys(object); let count = keys.length === expected.length ? 0 : 1; for (let i = 0; i < expected.length; i++) if (keys[i] !== expected[i]) count++; return count }
function show(label, object, expected) {
  const wanted = expected.join(), enumerated = []
  for (const key in object) enumerated.push(key)
  console.log(
    label,
    expected.length,
    countDifferences(object, expected),
    enumerated.join() === wanted,
    Reflect.ownKeys(object).join() === wanted,
    Object.getOwnPropertyNames(object).join() === wanted,
    Object.entries(object).map(entry => entry[0]).join() === wanted,
    Object.keys({ ...object }).join() === wanted,
    Object.keys(Object.assign({}, object)).join() === wanted,
    Object.keys(JSON.parse(JSON.stringify(object))).join() === wanted,
  )
}

const alternating = new Bag(), alternatingModel = ["first"]
let differences = 0
for (let i = 0; i < 5000; i++) {
  alternating["k" + i] = i
  alternatingModel.push("k" + i)
  alternating.mark(i)
  if (i % 500 === 0 || (i >= 4085 && i <= 4105)) differences += countDifferences(alternating, [...alternatingModel, "late"])
  alternating.unmark()
}
alternating.mark(-1)
alternatingModel.push("late")
show("alternating", alternating, alternatingModel)
console.log(differences, alternating.total(), alternating.k4999, "late" in alternating)

const wide = new Bag(), wideModel = ["first"]
for (let i = 0; i < 70000; i++) {
  wide["k" + i] = i
  wideModel.push("k" + i)
}
wide.mark(1)
show("wide", wide, [...wideModel, "late"])
wide.unmark()
wide.extra = 2
wide.mark(3)
show("wide again", wide, [...wideModel, "extra", "late"])
console.log(wide.total(), wide["k" + 69999], wide.extra)

const small = new Bag()
small.mark(1)
small.x = 2
small.unmark()
small.mark(3)
show("small", small, ["first", "x", "late"])
console.log(small.total())
delete small.x
show("small without x", small, ["first", "late"])
small.x = 4
show("small with x again", small, ["first", "late", "x"])
