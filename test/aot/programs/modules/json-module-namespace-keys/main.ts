// The namespace of a JSON module has every key of the file, also one that is no identifier, `__proto__` and `__esModule`, as in plain Bun.
import * as ns from "./data.json"
import whole, { name, nested } from "./data.json"
const held: Record<string, unknown> = ns
console.log(JSON.stringify(Object.keys(held)))
console.log(JSON.stringify(Reflect.ownKeys(held).map(String)))
for (const key of ["name", "a-b", "__proto__", "__esModule", "1", "with space", "", "class", "\u00e9", "nested", "absent"]) console.log(JSON.stringify(key), key in held, JSON.stringify(held[key]))
console.log(name, nested === whole.nested, held.default === whole, JSON.stringify(Object.keys(whole)))
const late: Record<string, unknown> = await import("./data.json")
console.log(JSON.stringify(Object.keys(late)), late === held)
