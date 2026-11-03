// Objects of one class get their late properties in every order. Whatever the order, each object reads back what it was given, lists its keys in the order of creation,
// and keeps its other properties when one more is added between them, deleted, redefined or frozen.
class Record {
  constructor(id) {
    this.id = id
    this.tag = "r" + id
  }
}

const names = ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12", "n13", "n14", "n15", "n16", "n17", "n18", "n19"]
function set(record, name, value) {
  switch (name) {
    case "n0": record.n0 = value; break
    case "n1": record.n1 = value; break
    case "n2": record.n2 = value; break
    case "n3": record.n3 = value; break
    case "n4": record.n4 = value; break
    case "n5": record.n5 = value; break
    case "n6": record.n6 = value; break
    case "n7": record.n7 = value; break
    case "n8": record.n8 = value; break
    case "n9": record.n9 = value; break
    case "n10": record.n10 = value; break
    case "n11": record.n11 = value; break
    case "n12": record.n12 = value; break
    case "n13": record.n13 = value; break
    case "n14": record.n14 = value; break
    case "n15": record.n15 = value; break
    case "n16": record.n16 = value; break
    case "n17": record.n17 = value; break
    case "n18": record.n18 = value; break
    default: record.n19 = value
  }
}
function readAll(record) {
  return [record.n0, record.n1, record.n2, record.n3, record.n4, record.n5, record.n6, record.n7, record.n8, record.n9,
    record.n10, record.n11, record.n12, record.n13, record.n14, record.n15, record.n16, record.n17, record.n18, record.n19]
}
function describe(record) {
  return readAll(record).map(value => value === undefined ? "-" : typeof value === "object" ? "o" + value.id : String(value)).join(",")
}

function permutations(list) {
  if (list.length < 2) return [list]
  const result = []
  for (let i = 0; i < list.length; i++)
    for (const rest of permutations([...list.slice(0, i), ...list.slice(i + 1)])) result.push([list[i], ...rest])
  return result
}

let checksum = 0
let wrong = 0
const kept = []
const chosen = ["n0", "n1", "n2", "n9", "n19"]
let id = 0
for (const order of permutations(chosen)) {
  const record = new Record(id++)
  const expected = ["id", "tag"]
  for (const name of order) {
    set(record, name, name === "n9" ? record : name + ":" + record.id)
    expected.push(name)
    if (Object.keys(record).join() !== expected.join()) wrong++
    for (const other of names) {
      const has = expected.includes(other)
      if ((record[other] !== undefined) !== has || Object.hasOwn(record, other) !== has || (other in record) !== has) wrong++
    }
  }
  checksum += describe(record).length
  kept.push(record)
}
console.log("orders", kept.length, "wrong", wrong, "checksum", checksum)
console.log(describe(kept[0]), Object.keys(kept[0]).join())
console.log(describe(kept[kept.length - 1]), Object.keys(kept[kept.length - 1]).join())

if (typeof Bun !== "undefined") Bun.gc(true)
wrong = 0
for (const record of kept) {
  if (record.n9 !== record || record.n0 !== "n0:" + record.id || record.n19 !== "n19:" + record.id) wrong++
}
console.log("after a collection, wrong", wrong)

// One name at a time, from the last to the first and back, with numbers, strings, objects and undefined.
const ladder = new Record(1000)
for (let i = names.length; i--;) set(ladder, names[i], i % 4 === 0 ? i : i % 4 === 1 ? "s" + i : i % 4 === 2 ? ladder : undefined)
console.log(describe(ladder), Object.keys(ladder).join())
for (let i = 0; i < names.length; i += 2) delete ladder[names[i]]
console.log(describe(ladder), Object.keys(ladder).join())
for (let i = 0; i < names.length; i += 2) set(ladder, names[i], i + 0.5)
console.log(describe(ladder), Object.keys(ladder).join())

// Redefined, frozen and sealed objects. The file is a module, so a refused store throws.
function attempt(action) {
  try { return String(action()) } catch (error) { return error.constructor.name }
}
const redefined = new Record(2000)
redefined.n3 = 3
redefined.n12 = 12
Object.defineProperty(redefined, "n7", { value: 7, writable: false, enumerable: false, configurable: true })
Object.defineProperty(redefined, "n12", { get() { return this.n3 * 4 }, enumerable: true, configurable: true })
Object.defineProperty(redefined, "n15", { value: 15, writable: true, enumerable: true, configurable: true })
redefined.n15 = 150
console.log(attempt(() => redefined.n7 = 70), attempt(() => redefined.n12 = 1), describe(redefined), Object.keys(redefined).join(), JSON.stringify(Object.getOwnPropertyDescriptor(redefined, "n7")))

const frozen = new Record(3000)
frozen.n1 = 1
frozen.n18 = 18
Object.freeze(frozen)
console.log(attempt(() => frozen.n1 = 2), attempt(() => frozen.n5 = 5), attempt(() => delete frozen.n18), attempt(() => set(frozen, "n18", 1)), attempt(() => set(frozen, "n6", 6)))
console.log(describe(frozen), Object.keys(frozen).join(), Object.isFrozen(frozen))

const sealed = new Record(4000)
sealed.n2 = 2
Object.seal(sealed)
sealed.n2 = 22
console.log(attempt(() => sealed.n4 = 4), attempt(() => set(sealed, "n17", 17)), attempt(() => delete sealed.n2), describe(sealed), Object.keys(sealed).join())

const closed = new Record(5000)
closed.n10 = 10
Object.preventExtensions(closed)
closed.n10 = 100
console.log(attempt(() => closed.n11 = 11), describe(closed), delete closed.n10, describe(closed))
console.log(attempt(() => closed.n10 = 1), attempt(() => set(closed, "n10", 1)), describe(closed))

// Copies.
const copy = { ...ladder }
const assigned = Object.assign(new Record(6000), ladder)
console.log(Object.keys(copy).join(), describe(assigned), assigned.id, JSON.stringify(Object.entries(redefined).map(entry => entry[0])))
console.log(JSON.stringify(structuredClone({ ...kept[3], n9: undefined })))
