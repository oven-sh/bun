// A `var` that only sees `= 0`, `++`, `--` and `+= 1` is an integer, provided that nothing reads it before its declaration has run.
var moduleCount = 0
function stackOf() {
  var count = 0
  var depth = 0
  var total = 0
  var items: (string | undefined)[] = []
  function push(item: string) { items[count] = item; count++; total += 1; moduleCount++ }
  function pop() { count--; const item = items[count]; items[count] = undefined; return item }
  function nested(levels: number): number { depth++; const deepest = levels > 0 ? nested(levels - 1) : depth; depth--; return deepest }
  return { push, pop, nested, state: () => [count, depth, total, items.length].join(",") }
}
const stack = stackOf()
for (const word of ["a", "b", "c", "d"]) stack.push(word)
console.log(stack.state(), stack.pop(), stack.pop(), stack.state(), stack.nested(5), stack.state())
stack.push("e"); console.log(stack.state(), stack.pop(), stack.pop(), stack.pop(), stack.state(), moduleCount)
// Below zero: the index is a property name then.
console.log(String(stack.pop()), stack.state())
stack.push("f"); console.log(stack.state())

function readEarly() {
  const seen: string[] = []
  bump()
  var early = 0
  bump()
  function bump() { early++; seen.push(String(early)) }
  return seen.join(",")
}
console.log(readEarly())
function readLate(skip: boolean) {
  const bump = () => { late++; return String(late) }
  if (skip) return bump()
  var late = 10
  return bump()
}
console.log(readLate(false), readLate(true))
let big = 0
function many() { var n = 0; for (var i = 0; i < 100000; i++) { n++; if (i % 3 == 0) n-- } return n }
big += many(); console.log(big)
