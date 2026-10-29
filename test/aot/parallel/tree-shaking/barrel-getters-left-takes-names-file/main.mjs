// A barrel of getters without side effects is imported for nothing and left out. One file that it takes a name from keeps its object (it asks for module.parent), so the barrel would have one, and so has the other file that the barrel takes a name from: that file runs, and defines its getter on its object.
// Reference: bun build --compile
import "p";
import { a } from "p/x.cjs";
import { read } from "./r.cjs";
console.log(a, read());
