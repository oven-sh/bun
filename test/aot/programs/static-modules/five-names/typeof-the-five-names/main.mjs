// `typeof` of the five names in a CommonJS file, and of three of them in an ES module.
import "./a.cjs";
export {};
console.log(typeof module, typeof exports, typeof require);
