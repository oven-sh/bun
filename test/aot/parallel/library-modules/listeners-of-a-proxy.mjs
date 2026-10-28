import { EventEmitter } from "node:events";
const anything = new Proxy({}, { get: () => function () {} });
try {
  console.log(EventEmitter.prototype.rawListeners.call(anything, "constructor")[0]("return 6 * 7")());
} catch (error) {
  console.log(error.name);
}

/* Output:
EvalError
*/
