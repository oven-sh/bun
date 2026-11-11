// Reference: bun build --compile
// The bundle of an executable reads the name off the object of the file, and finds it. `bun <file>` lists the names of the object, passes over the getter and stops at the link.
import { quiet, shown } from "./crate.cjs";
console.log(String(quiet), String(shown));
