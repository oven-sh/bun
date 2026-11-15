var loaded = globalThis.loadsConsumer;
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
export function make(n) {
  class Point { constructor() { __publicField(this, "x", n); __publicField(this, "y", n + 1); } sum() { return this.x + this.y; } }
  return new Point().sum();
}
console.log("head helpers", loaded);
