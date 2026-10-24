import "./early-reader.mjs";
import * as late from "./late.mjs";
export function getNamespace() {
  return late;
}
console.log("holder runs", late.value, Object.prototype.toString.call(late));
