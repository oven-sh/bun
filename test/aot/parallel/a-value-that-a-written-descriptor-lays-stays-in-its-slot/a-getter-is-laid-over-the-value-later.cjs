"use strict";
const holder = {};
Object.defineProperty(holder, "mark", { value: 4, configurable: true, enumerable: true });
function read() { let sum = 0; for (let i = 0; i < 30; i++) sum = (sum + holder.mark) | 0; return sum; }
let said = 0, asked = 0;
for (let turn = 0; turn < 300; turn++) {
  if (turn === 150) Object.defineProperty(holder, "mark", { get() { asked++; return 6; }, configurable: true, enumerable: true });
  said = (said + read()) % 1000003;
}
console.log(said, asked, typeof Object.getOwnPropertyDescriptor(holder, "mark").get);
