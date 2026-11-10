import * as self from "./lib.mjs";
import "./dep.mjs";
export default 7;
export function unused(text) { return eval(text); }
console.log("SAID while", typeof self.__esModule, "__esModule" in self, Object.keys(self).join(), Reflect.ownKeys(self).map(String).join());
export function later() { return [typeof self.__esModule, "__esModule" in self, Object.keys(self).join()].join(" "); }
