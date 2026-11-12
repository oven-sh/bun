"use strict";
const above = Object.create({});
Object.defineProperty(above, "size", { enumerable: true, get: function () { return this.width * 2; } });
above.width = 1;
const heir = Object.create(above); heir.width = 7;
function use(holder, turn) { let sum = turn & 1; for (let i = 0; i < 60; i++) sum = (sum + holder.size) | 0; return sum >>> 0; }
let said = 0; for (let turn = 0; turn < 900; turn++) said = (said + use(turn % 2 === 0 ? above : heir, turn)) % 1000003;
console.log(said);
