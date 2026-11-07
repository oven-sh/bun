// While `process._maxListeners` is undefined, getMaxListeners of `process` answers the default of node:events, which hands it to native code each time the program changes it.
// STATISTIC: ImageFunctionsEmitted <= 120
const events = require("node:events");
console.log(process.getMaxListeners());
events.defaultMaxListeners = 2;
console.log(process.getMaxListeners(), events.defaultMaxListeners);
events.setMaxListeners(7);
console.log(process.getMaxListeners(), events.defaultMaxListeners);
console.log(process.setMaxListeners(Infinity) === process, process.getMaxListeners());
process._maxListeners = undefined;
console.log(process.getMaxListeners());
try {
  events.defaultMaxListeners = "many";
} catch (error) {
  console.log(error.code, process.getMaxListeners());
}
