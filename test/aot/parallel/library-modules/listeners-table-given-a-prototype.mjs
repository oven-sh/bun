import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
for (const value of Object.values(emitter))
  if (value && typeof value === "object") Object.setPrototypeOf(value, function () {});
console.log(emitter.rawListeners("constructor")[0]("return 6 * 7")());
