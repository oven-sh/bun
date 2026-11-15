"use strict";
function double(n) { return (n * 2) | 0; }
const tools = {};
Object.defineProperty(tools, "scale", { enumerable: true, value: double });
function use(turn) { let sum = 0; for (let i = 0; i < 50; i++) sum = (sum + tools.scale(i + turn)) | 0; return sum; }
const names = ["sc" + "ale".slice(0, 3), "other"];
function tried(deed) { try { return String(deed()); } catch (error) { return error instanceof TypeError ? "throws" : "other"; } }
let said = 0, told = "";
for (let turn = 0; turn < 400; turn++) {
  if (turn === 200) told = [tried(() => { tools[names[0]] = null; }), tried(() => Object.assign(tools, { scale: null })), tried(() => Reflect.set(tools, "scale", null)), tried(() => Reflect.set(tools, names[0], null))].join(" ");
  said = (said + use(turn)) % 1000003;
}
console.log(said, told, tools.scale === double);
