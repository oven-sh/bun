import { early, look } from "./second.js";

export const list = [1, 2, 3];
export let count = 3;
export var old = "set";
export class Shape {
  sides() {
    return 4;
  }
}
export function hoisted() {
  return "hoisted";
}
export function readsTheList() {
  return list.length;
}
export function grow() {
  count++;
  list.push(count);
}
export { early, look };
