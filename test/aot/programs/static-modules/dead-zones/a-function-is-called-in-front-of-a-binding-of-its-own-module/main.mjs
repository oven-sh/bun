// One reader of `late` runs too early and one does not; another module reads it too.
import { late, read } from "./a.mjs";
console.log("main", late, read());
