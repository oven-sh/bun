// Each key of a JSON module is an export of its own, which holds what the key held when the file was loaded.
import whole, { a, zeta } from "./files/data.json"
import * as ns from "./files/data.json"
whole.a = 99
whole.zeta = { y: 0, x: 0 }
const held: Record<string, unknown> = ns
console.log(a, ns.a, held.a, whole.a, zeta.x, ns.zeta.x, zeta === ns.zeta, held.default === whole)
console.log(Object.keys(held).join(), JSON.stringify(Object.getOwnPropertyDescriptor(held, "a")), Object.isSealed(held), Object.isExtensible(held))
try {
  held.a = 5
  console.log("written", held.a)
} catch (error) {
  console.log((error as Error).name)
}
const late: Record<string, unknown> = await import("./files/data.json")
console.log(late.a, late.default === whole, late === held)
