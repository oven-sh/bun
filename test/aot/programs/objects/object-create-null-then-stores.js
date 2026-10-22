// Object.create(null), alone and beside other prototypes, followed by stores of constant names.
function table(a, b, c) {
  const o = Object.create(null)
  o.first = a
  o.second = b
  o.third = c
  return o
}
function wide(n) {
  const o = Object.create(null)
  o.a = n; o.b = n + 1; o.c = n + 2; o.d = n + 3; o.e = n + 4; o.f = n + 5; o.g = n + 6; o.h = n + 7; o.i = n + 8
  return o
}
function under(prototype) { return Object.create(prototype) }
function show(o) { return Object.keys(o).join() + " " + JSON.stringify(o) + " " + (Object.getPrototypeOf(o) === null) }

console.log(show(table(1, "two", null)), show(wide(10)), show(Object.create(null)))

const bare = table(1, 2, 3)
console.log("toString" in bare, "first" in bare, bare.toString, bare.hasOwnProperty, typeof bare, bare instanceof Object)
bare.__proto__ = { inherited: 1 }
console.log(Object.keys(bare).join(), Object.getPrototypeOf(bare), bare.inherited)

const base = { inherited: "yes" }
const prototypes = [null, base, null, Array.prototype, null, Object.prototype, function () {}]
console.log(prototypes.map(p => { const o = under(p); return (Object.getPrototypeOf(o) === p) + ":" + o.inherited + ":" + Object.keys(o).length }).join(" "))

for (const wrong of [undefined, 1, "text", true, Symbol.iterator, 10n]) {
  try { under(wrong); console.log("no error") } catch (error) { console.log(error.constructor.name) }
}

let kept = []
let sum = 0
for (let n = 0; n < 200000; n++) {
  const o = n & 1 ? table(n, n + 0.5, kept) : wide(n)
  if (n % 20000 === 0) kept.push(o)
  sum += n & 1 ? o.second : o.i
  if (Object.getPrototypeOf(o) !== null) sum = NaN
}
console.log(sum, kept.length, kept.map(o => Object.keys(o).length).join())

const frozen = Object.freeze(Object.create(null))
try { (function () { "use strict"; frozen.x = 1 })() } catch (error) { console.log(error.constructor.name) }
console.log(Object.keys(frozen).length, Object.isFrozen(frozen))
