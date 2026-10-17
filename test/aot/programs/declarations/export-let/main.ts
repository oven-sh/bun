// An exported `let` is assigned in its own module and read from another module.
import { bump, hits, label, limit, read, state } from "./dep"
export let count = 0
export let total: number = 10
export const base = 3
const derived = base + 1
export enum Level { Low = 1, High = 5 }
function inc(): void { count++; total += count * 1000000 }
inc(); inc(); inc()
console.log(count, total, derived, Level.High + base)
console.log(hits, label, limit)
bump(); bump()
console.log(hits, label, read(), state())
