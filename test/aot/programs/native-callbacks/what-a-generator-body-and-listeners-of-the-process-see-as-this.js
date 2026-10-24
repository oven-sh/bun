// What a body that is a generator function, the callback for uncaught exceptions and listeners of the process see as `this` and as their arguments.
const lines = [];
function seen(name, self, given) {
  lines.push(name + ": this " + (self === undefined ? "undefined" : self === process ? "process" : self === globalThis ? "globalThis" : typeof self) + ", " + given.length + ": " + Array.from(given, v => (v instanceof Error ? v.constructor.name : typeof v)).join());
}
lines.push(await new Response(async function* () { seen("body", this, arguments); yield "a"; yield "b"; }).text());
lines.push(await new Response({ async *[Symbol.asyncIterator]() { seen("@@asyncIterator", typeof this, arguments); yield "c"; } }).text());
process.on("uncaughtException", function (error, origin) { seen("uncaughtException", this, arguments); lines.push(origin); });
await new Promise(resolve => { setTimeout(() => { setTimeout(resolve, 5); throw new RangeError("first"); }, 1); });
process.removeAllListeners("uncaughtException");
process.setUncaughtExceptionCaptureCallback(function (error) { seen("capture callback", this, arguments); });
await new Promise(resolve => { setTimeout(() => { setTimeout(resolve, 5); throw new TypeError("second"); }, 1); });
process.setUncaughtExceptionCaptureCallback(null);
process.on("unhandledRejection", function (reason, promise) { seen("unhandledRejection", this, arguments); });
Promise.reject(new EvalError("third"));
await new Promise(resolve => setTimeout(resolve, 5));
process.on("beforeExit", function (code) { seen("beforeExit", this, arguments); });
process.on("exit", function (code) { seen("exit", this, arguments); console.log(lines.join("\n")); });
