import { Middle } from "./main.mjs";
export function Base(a) {
  this.b = 0;
}
export function makeLeaf() {
  return class Leaf extends Middle {
    constructor(a) {
    }
  };
}
export function Last(a) {
}
