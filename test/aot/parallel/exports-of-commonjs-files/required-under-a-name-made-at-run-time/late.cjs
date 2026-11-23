"use strict";
let out = "";
for (const name of ["su", "su"]) out += require("./" + name + "m.cjs")("a", name) + ";";
console.log(out);
