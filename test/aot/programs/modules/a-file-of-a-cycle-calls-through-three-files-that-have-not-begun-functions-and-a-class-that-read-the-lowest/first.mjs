import "./second.mjs";
import * as third from "./third.mjs";
import Made, { make } from "./third.mjs";
export function viaThird() {
  return third.readBelow();
}
export function viaClass() {
  return [typeof Made, make().value];
}
console.log("first ends");
