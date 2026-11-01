// An export is named NaN. A pattern reads it from the namespace object of the module itself, and a function that is also handed an array asks what it got.
import * as n from "./main.mjs";
export const NaN = {};
const { NaN: q } = n;
console.log(f(q), f([1]));
function f(v) { return Array.isArray(v) ? v.length : typeof v; }
