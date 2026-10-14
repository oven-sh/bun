// An exported `let` of a number without initializer, which only ANOTHER file reads before the first store.
import { flag, level, set } from "./dep"
console.log(level, flag, typeof level, level === undefined)
set()
console.log(level, flag, typeof level)
