// `process` keeps its limit of listeners where node:events keeps one: in `_maxListeners`, and in the default of node:events while that is undefined. What the program stores in either is what the native getMaxListeners answers.
const events = require("node:events");
console.log(process.getMaxListeners(), events.getMaxListeners(process), Object.hasOwn(process, "_maxListeners"));
events.defaultMaxListeners = 2;
console.log(process.getMaxListeners(), events.getMaxListeners(process));
console.log(process.setMaxListeners(Infinity) === process, process.getMaxListeners(), events.getMaxListeners(process));
events.setMaxListeners(1.5, process);
console.log(process.getMaxListeners(), process._maxListeners);
process._maxListeners = undefined;
events.setMaxListeners(7);
console.log(process.getMaxListeners(), events.defaultMaxListeners);
const other = {};
console.log(
  process.setMaxListeners.call(other, 1) === other,
  process.getMaxListeners.call(other),
  Object.keys(other).join(),
);
try {
  process.setMaxListeners(-1);
} catch (error) {
  console.log(error.code, error.message);
}
try {
  events.defaultMaxListeners = "many";
} catch (error) {
  console.log(error.code, process.getMaxListeners());
}
