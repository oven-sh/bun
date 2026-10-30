import { readFifth, Kept } from "./fourth.mjs";
export function readBelow() {
  return readFifth();
}
export function make() {
  return new Kept();
}
export default function Made() {}
console.log("third ends");
