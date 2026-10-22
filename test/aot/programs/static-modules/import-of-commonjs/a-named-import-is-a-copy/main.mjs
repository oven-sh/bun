// A named import of a CommonJS file is a copy; the default import is the object.
// STATISTIC: Faces >= 1
import a, { n, set } from "./a.cjs";
set();
console.log(n, a.n);
