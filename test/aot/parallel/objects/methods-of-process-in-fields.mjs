// A method of `process` on another receiver makes a native emitter, which stands below EventEmitter.prototype, and stores it as receiver._events: the program comes to EventEmitter.prototype by it, however it came by the method (here: a field).
import { EventEmitter } from "node:events";
let acts = 0;
class Base extends EventEmitter { constructor(k) { super(); this.k = k; } }
function total(count) { let t = 0; for (let i = 0; i < count; i++) t += new Base(i).k | 0; return t; }
const said = [total(40)];
const o = { on: process.on };
o.on("x", () => {});
const q = Object.getPrototypeOf(Object.getPrototypeOf(o._events));
Object.setPrototypeOf(q, { extra: 1, set k(v) { acts += 31; }, get k() { return 8; } });
said.push(total(40), acts, q === EventEmitter.prototype, new Base(3).extra);
console.log(said.join());
