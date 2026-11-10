import { who, hit, hits } from "./leaf.mjs";
import { describe as describeShape } from "./shape.mjs";
export let count = 0;
export var legacy;
export function bump() {
  count += 1;
  legacy = "set " + count;
  return count;
}
export class Box {
  static made = 0;
  constructor(value) {
    this.value = value;
    Box.made++;
  }
  who() {
    return who + ":" + this.value;
  }
}
export default function named() {
  return "default of counter " + who + " " + hit() + " " + hits;
}
export const arrow = () => describeShape() + "/" + count;
export { who as leafName };
