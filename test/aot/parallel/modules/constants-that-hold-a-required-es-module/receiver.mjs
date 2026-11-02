import * as self from "./receiver.mjs";
export function describeThis() {
  return this === self ? "the namespace" : String(this);
}
