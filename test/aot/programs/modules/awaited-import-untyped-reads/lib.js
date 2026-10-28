import { log } from "./log.js";
log("lib is evaluated");
export const constant = 10;
export function twice(value) {
  return value * 2;
}
export let counter = 0;
export function increment() {
  counter++;
}
export const arrow = value => value + 100;
export class Box {
  constructor(value) {
    this.value = value;
  }
}
export default 1000;
