"use strict";
const holder = {};
function lay(value) { Object.defineProperty(holder, "mark", { value, configurable: true }); }
function read() { let sum = 0; for (let i = 0; i < 30; i++) sum = (sum + holder.mark) | 0; return sum; }
let said = 0;
for (let turn = 0; turn < 300; turn++) { lay(turn & 15); said = (said + read()) % 1000003; }
const found = Object.getOwnPropertyDescriptor(holder, "mark");
console.log(said, found.value, found.writable, found.enumerable, found.configurable);
