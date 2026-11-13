import { EventEmitter } from "node:events";
import * as space from "./space.mjs";
console.log(EventEmitter.prototype.rawListeners.call(space, "constructor")[0]("return 6 * 7")());
