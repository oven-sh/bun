// A Set is created from a string at a module's top level, next to module variables that start as null.
import { s, t, c, d, e } from "./files/m.ts"
console.log(s.size, t, c.size, d, e)
console.log(s.has("a"), s.has("abc"), c.has("M"), [...c].join(""))
const twice = new Set("aabbc")
console.log(twice.size, [...twice].join("|"))
