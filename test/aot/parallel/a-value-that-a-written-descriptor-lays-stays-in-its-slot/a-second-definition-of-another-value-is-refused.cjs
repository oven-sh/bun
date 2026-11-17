"use strict";
function lay(holder, value) { Object.defineProperty(holder, "mark", { value, enumerable: true }); }
const holder = {};
let said = "";
for (let turn = 0; turn < 300; turn++) {
  try { lay(holder, turn < 200 ? 5 : turn); said += turn === 0 || turn === 199 ? "laid " : ""; } catch (error) { if (turn === 200 || turn === 299) said += (error instanceof TypeError) + " "; }
}
let sum = 0; for (let i = 0; i < 100; i++) sum += holder.mark;
console.log(said, sum, Reflect.defineProperty(holder, "mark", { value: 6 }), Reflect.defineProperty(holder, "mark", { value: 5 }), holder.mark);
