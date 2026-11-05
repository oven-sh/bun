// `process` keeps its listeners in native code and its limit where node:events keeps one: in `_maxListeners`, and in the default of node:events while that is undefined. What the program stores in either is what native code reads.
const events = require("node:events");
process.on("warning", warning => console.log(warning.count, String(warning.type), warning.emitter === process));
events.defaultMaxListeners = 2;
console.log(process.getMaxListeners(), events.getMaxListeners(process), Object.hasOwn(process, "_maxListeners"));
for (let i = 0; i < 3; i++) process.on("over the default", () => {});
console.log(process.setMaxListeners(Infinity) === process, process.getMaxListeners(), events.getMaxListeners(process));
for (let i = 0; i < 30; i++) process.on("no limit", () => {});
process._maxListeners = "1";
process.once("over a string", () => {});
process.prependOnceListener("over a string", () => {});
const other = {};
console.log(process.setMaxListeners.call(other, 1) === other, other._maxListeners, process.getMaxListeners.call(other));
process.on.call(other, "other receiver", () => {});
process.on.call(other, "other receiver", () => {});
const emitter = new events.EventEmitter();
for (let i = 0; i < 3; i++) emitter.on("emitter of node:events", () => {});
try {
  process.setMaxListeners(-1);
} catch (error) {
  console.log(error.code, error.message);
}
