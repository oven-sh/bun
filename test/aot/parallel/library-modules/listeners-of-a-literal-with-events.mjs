import { EventEmitter } from "node:events";
const found = EventEmitter.prototype.listeners.call({ _events: function () {} }, "constructor")[0];
console.log(found.name, found("return 6 * 7")());
