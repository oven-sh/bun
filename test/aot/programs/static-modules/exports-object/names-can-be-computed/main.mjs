// The names of the exports can be computed, and an ES module can still import one by name.
import { a } from "./a.cjs";
console.log(a, Object.keys(require("./a.cjs")).join());
