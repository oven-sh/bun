// A function under 0 is read from the namespace of a CommonJS literal by a call in brackets.
import * as h from "./other.cjs";
console.log(h["0"]());
