import { EventEmitter } from "node:events";
const anything = new Proxy({}, { get: () => function () {} });
try {
  console.log(EventEmitter.prototype.rawListeners.call(anything, "constructor")[0]("return 6 * 7")());
} catch (error) {
  // An executable runs the text or refuses it with an EvalError.
  console.log(error.name);
}

/* Output:
42
*/
