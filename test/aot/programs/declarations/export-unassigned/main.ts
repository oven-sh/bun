// An exported `let` of type `number` without an initializer is read by another file before the first assignment.
import { flag, level, set } from "./dep"
console.log(level, flag, typeof level, level === undefined)
set()
console.log(level, flag, typeof level)
