import "./second.mjs";
import { Kind, changing, count, fraction } from "./third.mjs";
export function readVar() {
  return count;
}
export function readFraction() {
  return fraction;
}
export function readLet() {
  return changing;
}
export function readStatic() {
  return Kind.z;
}
console.log("first ends");
