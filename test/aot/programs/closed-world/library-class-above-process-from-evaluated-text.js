// Once node:events is loaded, its EventEmitter.prototype is the last object above process, so text that is evaluated at run time finds a class of the library without being handed anything. The program never constructs an emitter. Whoever holds process finds what lies above it, so the compiler counts the class among what the text can call, and the text constructs it as in plain Bun. closed-world/uncalled-library-functions-from-evaluated-text-admitted is the same program built with --compile-inspector.
import { EventEmitter } from "node:events";
// Text that is decoded at run time is unknown to the compiler.
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  return message.includes("bun compile differs from bun run here") ? "refused: " + message : error.name;
}
function attempt(label, text) {
  try { console.log(label + ": " + (0, eval)(decoded(text))); } catch (error) { console.log(label + ": " + outcome(error)); }
}
const emitterClass = "(() => { let above = process; while (Object.getPrototypeOf(above) !== Object.prototype) above = Object.getPrototypeOf(above); return above.constructor; })()";

console.log("imported: " + typeof EventEmitter);
attempt("the class above process", "typeof " + emitterClass + " + ' ' + " + emitterClass + ".name");
attempt("constructed in the text", "new (" + emitterClass + ")().listenerCount('x')");
attempt("a setter of the class", emitterClass + ".defaultMaxListeners = 11");
attempt("constructed again", "typeof new (" + emitterClass + ")().on");
console.log("the program goes on");
