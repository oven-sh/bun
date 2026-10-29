// A CommonJS file defines a getter that returns a name of a second file, where a getter returns a binding of the top level. A module imports the
// name from the first file and, beside it, the default, which it looks at as a whole; another module hands the name on.
import outer, { number } from "./outer.cjs";
import { number as handedOn, whole } from "./hands-on.mjs";

console.log(outer, number, handedOn, whole === outer);
