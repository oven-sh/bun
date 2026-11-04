import { format } from "node:util";
import { join } from "node:path";
import { EventEmitter } from "node:events";
function mine(a, b) { return "mine" + a + b; }
class Mine { constructor(a) { this.a = a; } listenerCount() { return -1; } }
const functions = [mine, format, join];
const classes = [Mine, EventEmitter];
let text = "";
for (let i = 0; i < 6; i++) text += functions[i % 3]("%s", "x" + i) + new classes[i & 1](i).listenerCount("x") + ";";
const holder = { run: mine };
for (let i = 0; i < 4; i++) { if (i === 2) holder.run = format; text += holder.run("%s!", i); }
console.log(text);
