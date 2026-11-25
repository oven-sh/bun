"use strict";
function join(a, b) { return (a + b) | 0; }
function part(a, b) { return (a - b) | 0; }
const above = { join: part };
const tools = Object.create(above), others = Object.create(above);
Object.defineProperty(tools, "join", { enumerable: true, configurable: true, get: function () { return join; } });
Object.defineProperty(others, "join", { enumerable: true, configurable: true, get: function () { return join; } });
const names = ["jo" + "in"];
function use(holder, turn) { let sum = turn & 1; for (let i = 0; i < 60; i++) sum = (sum + holder.join(i, turn)) | 0; return sum >>> 0; }
let said = 0;
for (let turn = 0; turn < 600; turn++) {
  if (turn === 300) { delete tools[names[0]]; Reflect.defineProperty(others, names[0], { value: part }); }
  said = (said + use(tools, turn) + use(others, turn)) % 1000003;
}
console.log(said, Object.hasOwn(tools, "join"), typeof Object.getOwnPropertyDescriptor(others, "join").value);
