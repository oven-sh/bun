// A module on a cycle reads bindings that are not yet made.
import { a, fa } from "./a.mjs";
console.log(a, fa());
