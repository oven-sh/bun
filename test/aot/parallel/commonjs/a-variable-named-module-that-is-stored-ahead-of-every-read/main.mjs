// `var module` in a CommonJS file declares the parameter of the wrapper again: it begins as the module object. Here a store stands ahead of every read, so nobody sees that,
// and the file hands nothing on that leads to other files.
// STATISTIC: ImageFunctionsEmitted <= 10
import { view } from "./lists.cjs";
console.log(view(String));
