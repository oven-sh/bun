// A run of reads of late properties, with code in between that gives the same object more of them: a getter, a valueOf, a callback, a setter on the prototype.
// Each read sees the value that the object holds at that moment.
class Node {
  constructor(id) {
    this.id = id
  }
  get grow() {
    this.f1 = "g1"
    this.f0 = "g0"
    return "grown"
  }
  set push(value) {
    this.f2 = value
    this.f14 = value + 1
  }
}

function readRun(node) {
  return [node.f5, node.f9, node.grow, node.f0, node.f1, node.f5, node.f9, node.f13].join()
}
function readWithCallback(node, callback) {
  const before = node.f9
  const first = node.f5
  callback(node)
  return [before, first, node.f3, node.f4, node.f5, node.f9].join()
}
function sumWithValueOf(node) {
  return node.f5 + node.f6 + node.f7 + node.f5
}
function storeRun(node, value) {
  node.f13 = value
  node.push = value
  node.f12 = value + 2
  node.f2 = node.f2 + node.f14
  return [node.f2, node.f12, node.f13, node.f14].join()
}

const lines = []
for (let i = 0; i < 300; i++) {
  const node = new Node(i)
  node.f9 = "nine" + i
  node.f5 = i
  if (i % 3 === 0) node.f13 = "thirteen"
  const run = readRun(node)
  const again = readRun(node)
  const called = readWithCallback(node, target => { target.f4 = "four"; target.f3 = "three"; if (i % 2) target.f5 = -1 })
  node.f6 = { valueOf() { node.f8 = "eight"; node.f5 = 1000; node.f7 = 7; return 10 } }
  node.f7 = 1
  const sum = sumWithValueOf(node)
  const stored = storeRun(node, i)
  if (i < 4 || i === 299) lines.push([run, again, called, sum, stored, Object.keys(node).join()].join(" | "))
  if (i % 50 === 0 && typeof Bun !== "undefined") Bun.gc(true)
}
console.log(lines.join("\n"))

// for-in and Object.keys while the body adds and deletes.
const walked = new Node(1)
walked.f3 = 3
walked.f11 = 11
walked.f7 = 7
const seen = []
for (const key in walked) {
  seen.push(key + "=" + walked[key])
  if (key === "f3") { walked.f1 = 1; delete walked.f7 }
}
console.log(seen.join(), Object.keys(walked).join())

// Many objects that are kept alive while others die, so that storage is reused.
const survivors = []
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < 500; i++) {
    const node = new Node(i)
    node.f10 = [round, i]
    if (i % 5 === 0) node.f0 = node
    if (i % 7 === 0) { node.f14 = "x" + i; node.f2 = i / 2 }
    if (i % 97 === 0) survivors.push(node)
  }
}
if (typeof Bun !== "undefined") Bun.gc(true)
let total = 0
for (const node of survivors) total += node.f10[0] + node.f10[1] + (node.f0 === node ? 1 : 0) + (node.f14 ? node.f14.length : 0) + (node.f2 ?? 0)
console.log(survivors.length, total)
