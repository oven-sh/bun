// The constant holds what require() answers: it is the object of node:events in every function of the file, and naming it there lets nothing go.
// STATISTIC: ImageFunctionsEmitted <= 480
const EventEmitter = require("node:events");
function make() {
  return new EventEmitter();
}
console.log(typeof make().on);
