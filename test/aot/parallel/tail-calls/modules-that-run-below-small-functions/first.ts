import { fromSecond } from "./second";
function add(a: number, b: number): number {
  return a + b;
}
function twice(v: number): number {
  return add(v, v);
}
console.log("first runs");
export const fromFirst = twice(fromSecond.length);
