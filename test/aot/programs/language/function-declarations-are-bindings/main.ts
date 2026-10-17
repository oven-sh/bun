// Function declarations are bindings: one closure per call of the enclosing function, and assignable.
import snapshot, { bump, current } from "./untyped/counter"
import crypto2, { hasSubtle } from "./untyped/ambient"
import * as counter from "./untyped/counter"
import fn, { named } from "./untyped/fn"
import "./untyped/js.js"

function outer(n: number) {
  function inner() { return n }
  const a = inner, b = inner
  const seen = new Set<unknown>([inner, inner, a])
  ;(inner as any).tag = "t" + n
  return [a === b, seen.size, (b as any).tag, inner(), a()]
}
console.log(outer(1).join(), outer(2).join())

function listeners() {
  const list: Array<() => void> = []
  let calls = 0
  function handler() { calls++ }
  list.push(handler)
  list.push(handler)
  const at = list.indexOf(handler)
  list.splice(at, 1)
  for (const f of list) f()
  return [at, list.length, calls, list.includes(handler)]
}
console.log(listeners().join())

function perIteration() {
  const made: Array<() => number> = []
  for (let i = 0; i < 3; i++) {
    function get() { return i }
    made.push(get)
    made.push(get)
  }
  return [made[0] === made[1], made[1] === made[2], made.map(f => f()).join("")]
}
console.log(perIteration().join())

function hoisted() {
  const early = later
  function later() { return "later" }
  return [early === later, early()]
}
console.log(hoisted().join())

console.log(snapshot, current())
bump()
console.log(snapshot, current(), counter.default, counter.current())
console.log(typeof crypto2, crypto2 === (globalThis as any).Reflect, hasSubtle)
console.log(fn(), named(), fn === named)

// The deleted field is optional. `delete` of a required field: type-rules/delete-optional-field.
const o: any = { a: { b: 1, c: 2 } as { b?: number; c?: number }, n: null }
console.log(delete o.a?.b, delete o.n?.b, delete o.missing?.["x"], delete o.a?.["c"], JSON.stringify(o), delete (o as any).a, JSON.stringify(o))
