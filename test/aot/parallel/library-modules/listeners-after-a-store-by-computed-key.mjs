import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter[["_ev", "ents"].join("")] = function () {};
console.log(emitter.rawListeners("constructor")[0]("return 6 * 7")());
