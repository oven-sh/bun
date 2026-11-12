"use strict";
const holder = {};
const how = { value: 21, enumerable: true };
Object.defineProperty(holder, "mark", how);
how.value = 22; how.writable = true;
function read() { let sum = 0; for (let i = 0; i < 30; i++) sum += holder.mark; return sum; }
let said = 0; for (let turn = 0; turn < 200; turn++) said += read();
let thrown = false; try { holder.mark = 23; } catch { thrown = true; }
console.log(said, thrown, holder.mark);
