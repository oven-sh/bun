"use strict";
function make(i) { return Object.freeze({ a: i, b: i }); }
function copy(s) { return { ...s }; }
let out = "";
for (let i = 0; i < 3; i++) {
  const made = copy(make(i));
  made.a = "stored"; made.c = 1; delete made.b;
  out += JSON.stringify(made) + Object.isFrozen(made) + "; ";
}
console.log(out);
