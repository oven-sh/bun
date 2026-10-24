// TypeScript writes `__extends` as the result of a function that is called where it is written, in front of the marker. The function only makes functions, so a file that may be seen half done has its marker all the same, and its `default` is a variable.
// STATISTIC: ModulesWithNames >= 2
import Derived from "./k.cjs";
import { lazy } from "./lazy.cjs";
console.log(new Derived().name(), lazy() === Derived);
