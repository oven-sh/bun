// An ES module imports names of a CommonJS module that lies on a cycle of requires. The names are copies, taken when both bodies have ended: a later store is seen through the object and not through the import.
// STATISTIC: Faces >= 1
import a, { early, late, bump } from "./a.cjs";
bump();
console.log(early, late, a.b.saw, a.b.now());
