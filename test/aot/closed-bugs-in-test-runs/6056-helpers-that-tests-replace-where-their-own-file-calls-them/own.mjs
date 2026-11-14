var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __assign = Object.assign;
export class Own { constructor() { __publicField(this, "x", 1); } }
export function make() { return new Own(); }
export function named() { const f = /* @__PURE__ */ __name((a) => a + 1, "named"); return [f.name, typeof f === "function" ? f(1) : f].join(); }
export function replaceInside() { __publicField = (o, k, v) => { o["inside_" + k] = v; }; }
export { __name, __publicField };
