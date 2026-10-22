// A getter on the exports runs once for an ES importer, when the copy is taken.
import { x } from "./a.cjs";
console.log(x, x);
