console.log("lib is evaluated");
export const constant = 10;
export function twice(value) {
  return value * 2;
}
export let counter = 0;
export function increment() {
  counter++;
}
export function self() {
  return this;
}
