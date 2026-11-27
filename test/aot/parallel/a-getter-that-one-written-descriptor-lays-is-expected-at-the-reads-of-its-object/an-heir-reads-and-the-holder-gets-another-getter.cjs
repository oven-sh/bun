"use strict";
function join(a, b) { return (a + b) | 0; }
function part(a, b) { return (a - b) | 0; }
let ran = 0, other = 0, seenThis = "nobody", thrown = "none";
const lay = (Object)[JSON.parse('"defineProperty"')];
const madeKey = JSON.parse('"join"');
function make(above) { return Object.create(above); }
const tools = make({}), heir = make(tools);
Object.defineProperty(tools, "join", { enumerable: true, configurable: true, get: function () { ran++; seenThis = this === tools ? "tools" : "another"; return join; } });
function use(holder, turn) { let sum = turn & 1; for (let i = 0; i < 100; i++) sum = (sum + holder.join(i, turn)) | 0; return sum >>> 0; }
let said = 0; for (let turn = 0; turn < 600; turn++) { if (turn === 300) { lay(tools, "join", { get: function () { other++; return part; } }); } try { said = (said + use(heir, turn)) % 1000003; } catch (error) { thrown = (error).name; } }
console.log("SAID sum", said);
console.log("SAID getter-ran", ran);
console.log("SAID other-ran", other);
console.log("SAID this", seenThis);
console.log("SAID thrown", thrown);
