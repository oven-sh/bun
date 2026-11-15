// The Function constructor comes out of code of the library under the name `constructor`, and runs the text, as in `bun <file>`: as a listener of an object whose `_events` a reviver has made a function.
import { EventEmitter } from "node:events";
const made = JSON.parse('{"_events":1}', (key, value) => (key === "_events" ? function () {} : value));
try {
  console.log(EventEmitter.prototype.rawListeners.call(made, "constructor")[0]("return 6 * 7")());
} catch (error) {
  console.log(error.name);
}

