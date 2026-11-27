// As methods-of-process-in-fields.mjs: JSON.stringify calls the method, which the object has for toJSON.
import { EventEmitter } from "node:events";
let acts = 0;
class Base extends EventEmitter { constructor(k) { super(); this.k = k; } }
function total(count) { let t = 0; for (let i = 0; i < count; i++) t += new Base(i).k | 0; return t; }
const said = [total(40)];
const o = { toJSON: process.eventNames };
said.push(JSON.stringify(o));
const q = Object.getPrototypeOf(Object.getPrototypeOf(o._events));
Object.setPrototypeOf(q, { set k(v) { acts += 31; }, get k() { return 8; } });
said.push(total(40), acts, q === EventEmitter.prototype);
console.log(said.join());
