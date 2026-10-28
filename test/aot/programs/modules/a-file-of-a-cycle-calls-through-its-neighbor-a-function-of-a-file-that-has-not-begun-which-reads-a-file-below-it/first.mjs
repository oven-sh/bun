import "./second.mjs";
import { count, changing, readFourthFromThird } from "./third.mjs";
export function readThird() {
  return [count, changing];
}
export function readFourth() {
  return readFourthFromThird();
}
console.log("first ends");
