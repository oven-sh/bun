const vm = require("vm");

function report(action) {
  try {
    console.log(action());
  } catch (error) {
    console.log(error.name + ": " + error.message);
  }
}

(0, eval)("let evalLocal = 1");
console.log(typeof evalLocal);

vm.runInThisContext("let a = 1; const b = 2");
function readA() {
  return a;
}
function readB() {
  return b;
}
console.log(readA(), readB(), typeof a, typeof b);
Bun.gc(true);

a = 3;
console.log(readA(), vm.runInThisContext("a"), globalThis.a);
report(() => {
  b = 4;
});
report(() => {
  "use strict";
  b = 4;
});
console.log(readB());
console.log(delete a, readA());
Bun.gc(true);
console.log(readA(), readB());

globalThis.shadowed = "property";
function readShadowed() {
  return shadowed;
}
function storeShadowed(value) {
  shadowed = value;
}
for (let i = 0; i < 10; i++) readShadowed();
console.log(readShadowed());
vm.runInThisContext("let shadowed = 'lexical'");
console.log(readShadowed(), globalThis.shadowed);
storeShadowed("stored");
console.log(readShadowed(), globalThis.shadowed);
console.log(delete shadowed, readShadowed());
Bun.gc(true);
console.log(readShadowed());

try {
  vm.runInThisContext("throw new Error('before the binding'); let dead = 1");
} catch (error) {
  console.log(error.message);
}
report(() => dead);
report(() => typeof dead);
report(() => {
  dead = 1;
});
console.log(delete dead);
Bun.gc(true);
report(() => dead);

globalThis.plainGlobal = 1;
function readPlainGlobal() {
  return plainGlobal;
}
for (let i = 0; i < 10; i++) readPlainGlobal();
Bun.gc(true);
globalThis.plainGlobal = 2;
console.log(readPlainGlobal());
