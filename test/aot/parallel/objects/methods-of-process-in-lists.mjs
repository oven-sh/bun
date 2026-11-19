// As methods-of-process-in-fields.mjs, off a list and by Function.prototype.call; the change is an accessor on the prototype itself.
import { EventEmitter } from "node:events";
let acts = 0;
class Base extends EventEmitter { constructor(k) { super(); this.k = k; } }
function total(count) { let t = 0; for (let i = 0; i < count; i++) t += new Base(i).k | 0; return t; }
const said = [total(40)];
const o = {};
const [f] = [process.once];
f.call(o, "x", () => {});
const q = Object.getPrototypeOf(Object.getPrototypeOf(o._events));
Object.defineProperty(q, "k", { get() { acts++; return 7; }, set(v) { acts += 100; }, configurable: true });
said.push(total(40), acts, q === EventEmitter.prototype);
console.log(said.join());
