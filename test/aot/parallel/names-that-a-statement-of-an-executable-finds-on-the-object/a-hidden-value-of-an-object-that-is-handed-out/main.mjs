// Reference: bun build --compile
// The file hands its object out, so it keeps it. The bundle reads the name off that object. `bun <file>` lists its names, passes over this one and throws a SyntaxError.
import { hidden, alias } from "./crate.cjs";
console.log(String(hidden), String(alias));
