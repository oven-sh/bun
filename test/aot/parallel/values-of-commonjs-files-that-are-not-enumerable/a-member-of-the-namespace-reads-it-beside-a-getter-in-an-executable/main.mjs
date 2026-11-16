// Reference: bun build --compile
// Under `bun run` the first is undefined: whoever lists the names of the object passes over it. The bundle reads the name off the object.
import * as ns from "./crate.cjs";
console.log(String(ns.hidden), String(ns.alias));
