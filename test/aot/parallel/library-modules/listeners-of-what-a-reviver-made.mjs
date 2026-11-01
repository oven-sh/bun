import { EventEmitter } from "node:events";
const made = JSON.parse('{"_events":1}', (key, value) => (key === "_events" ? function () {} : value));
try {
  console.log(EventEmitter.prototype.rawListeners.call(made, "constructor")[0]("return 6 * 7")());
} catch (error) {
  console.log(error.name);
}

/* Output:
EvalError
*/
