// Another file reads an exported `const` in its temporal dead zone, through an import cycle.
import { seen } from "./dep"
export const made: number = Math.abs(-5)
export const list: number[] = [Math.abs(-1)]
console.log(seen, made, list.length)
