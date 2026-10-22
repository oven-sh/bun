// `module.exports` can be a function with a property, or null.
import f, { p } from "./f.cjs";
import n from "./n.cjs";
console.log(typeof f, p, n, require("./n.cjs"));
