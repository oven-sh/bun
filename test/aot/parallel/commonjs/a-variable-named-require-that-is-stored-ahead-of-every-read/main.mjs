// `var require` in a CommonJS file begins as the function of the wrapper. A store stands ahead of every read.
// STATISTIC: ImageFunctionsEmitted <= 10
import { view } from "./lists.cjs";
console.log(view(String));
