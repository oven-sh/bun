// STATISTIC: KnownHelperCalls >= 1
"use strict";
const __defProp = Object.defineProperty;
const __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
const __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const p = +(process.argv[2] ?? 3);
class Point { constructor(x) { __publicField(this, "x", x); } }
let early; try { early = "made " + new Point(p).x; } catch (error) { early = error.name; }
console.log(early, new Point(p + 1).x);
