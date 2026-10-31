// A `--define` whose value is a dotted path reads a member of a namespace import.
// Flags: --define VALUE=ns.value
import * as ns from "./exports.mjs";
console.log(ns.other, VALUE);
