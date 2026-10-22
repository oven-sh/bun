// The namespace object of a CommonJS file: sorted, fixed when the copy is taken, with `default`.
import * as ns from "./a.cjs";
setTimeout(() => console.log(Object.keys(ns).join(), ns.default.late), 5);
