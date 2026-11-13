import * as self from "./lamp.mjs";
export default 7;
export function unused(text) { return eval(text); }
console.log("in front of the inner require", typeof self.__esModule);
console.log("the inner require", globalThis.again());
console.log("behind the inner require", typeof self.__esModule);
