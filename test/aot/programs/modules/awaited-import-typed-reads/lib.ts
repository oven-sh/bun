import { log } from "./log";
log("lib is evaluated");
export const constant = 10;
export function twice(value: number) {
  return value * 2;
}
export let counter = 0;
export function increment() {
  counter++;
}
export const arrow = (value: number) => value + 100;
export class Box {
  constructor(public value: number) {}
}
export default 1000;
