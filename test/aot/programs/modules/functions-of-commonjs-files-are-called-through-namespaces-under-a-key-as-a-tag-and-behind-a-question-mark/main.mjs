// Three CommonJS files store a function that reads another export of its file through `this`. A module imports the three namespaces and calls
// through each in one way only: under a written key, as the tag of a template, and behind `?.`.
import * as keyed from "./keyed.cjs";
import * as tagged from "./tagged.cjs";
import * as optional from "./optional.cjs";

console.log(keyed["readsAnother"]());
console.log(tagged.readsAnother`text`);
console.log(optional.readsAnother?.());
