// a.mjs and one line that never runs, which calls the method.
import { EventEmitter } from "node:events";
const never = process.argv.length > 99;
const text = ["let p = process; while (Object.getPrototypeOf(p) !== Object.prototype) p = Object.getPrototypeOf(p); return new p.constructor().listenerCount('x')", ""].join(never ? "x" : "");
let answer;
try { answer = new Function(text)(); } catch (error) { answer = error.name; }
if (never) new EventEmitter().listenerCount("x");
console.log(typeof EventEmitter, answer);
