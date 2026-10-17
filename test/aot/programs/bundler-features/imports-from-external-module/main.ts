// Imports from a module that is not compiled together with the program.
import def, { add, counter, bump, Thing } from "./ext-lib.js"
import * as lib from "./ext-lib.js"
console.log(def, add(2, 3), counter, lib.counter)
bump()
console.log(counter, lib.counter, new Thing(4).twice(), typeof lib, Object.keys(lib).join())
