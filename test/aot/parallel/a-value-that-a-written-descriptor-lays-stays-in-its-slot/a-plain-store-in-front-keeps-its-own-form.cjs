"use strict";
const holder = {};
holder.mark = 1;
Object.defineProperty(holder, "mark", { value: 2 });
function read() { let sum = 0; for (let i = 0; i < 30; i++) sum += holder.mark; return sum; }
let said = 0; for (let turn = 0; turn < 200; turn++) said += read();
holder.mark = 3;
const found = Object.getOwnPropertyDescriptor(holder, "mark");
console.log(said, read(), found.writable, found.enumerable, found.configurable, Object.keys(holder).join());
