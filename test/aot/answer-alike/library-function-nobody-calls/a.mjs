// Evaluated text finds the emitter class above process and calls a method of it that the program never calls.
import { EventEmitter } from "node:events";
const never = process.argv.length > 99;
const text = ["let p = process; while (Object.getPrototypeOf(p) !== Object.prototype) p = Object.getPrototypeOf(p); return new p.constructor().listenerCount('x')", ""].join(never ? "x" : "");
let answer;
try { answer = new Function(text)(); } catch (error) { answer = error.name; }
console.log(typeof EventEmitter, answer);
