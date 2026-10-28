// Of the functions that a CommonJS file stores, one that never names `this` and an arrow function are called through the namespace of the file;
// the file replaces one of them later, from a timer, with a function that reads `this`.
import * as file from "./file.cjs";

console.log(file.add(1, 2), file.arrow());
console.log(file.replaced());
setTimeout(() => console.log(file.replaced(), file.default.replaced()), 5);
