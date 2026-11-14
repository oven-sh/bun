// A library replaces a built-in function for the length of a call, but only if the descriptor says that it can. In an executable it leaves the function alone.
"use strict";
const { Buffer: B } = require("buffer");
const original = B.concat;
const descriptor = Object.getOwnPropertyDescriptor(B, "concat");
const passThrough = list => list;
const replace =
  descriptor?.writable === true || descriptor?.set !== undefined
    ? on => {
        B.concat = on ? passThrough : original;
      }
    : () => {};
replace(true);
console.log(B.concat === passThrough ? "replaced" : "kept");
replace(false);
console.log(B.concat === original, Buffer.concat([Buffer.from("a"), Buffer.from("b")]).toString());
/* Output:
kept
true ab
*/
