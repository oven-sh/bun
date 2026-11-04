// The entry point first imports a CommonJS file by its default and by a name, then a module that hands on a name of a second file, then a third file. The second file requires the entry point, which has not begun: it runs there and then, and the file reads what it exports.
// Alone: the module that the file requires is the one the executable was started as
import whole, { second } from "./both.cjs";
import * as handsOn from "./hands-on.mjs";
import * as stars from "./stars.cjs";
export { stars };
export { first, last } from "./stars.cjs";
console.log("main runs", typeof whole, second, Object.keys(handsOn).join(), Object.keys(stars).join());
