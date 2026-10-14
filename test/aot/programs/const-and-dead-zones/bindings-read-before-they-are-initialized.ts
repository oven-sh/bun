// Variables that are read before they are initialized.
function early() { return later }
function attempt(f: () => unknown) { try { return String(f()) } catch (e) { return (e as Error).name } }
console.log(attempt(early))
const later = Math.abs(-5)
console.log(attempt(early))
function earlyVar() { return v }
console.log(attempt(earlyVar))
var v = 7
console.log(attempt(earlyVar))
function earlyObject() { return box.n }
console.log(attempt(earlyObject))
let box = { n: 1 }
console.log(attempt(earlyObject))
function inner() {
  const read = () => local
  const first = attempt(read)
  const local = String("set")
  return first + " " + attempt(read)
}
console.log(inner())
var never: number | undefined
console.log(attempt(() => never))
class Late { static make() { return new Late() } }
console.log(attempt(() => typeof Late.make()))
