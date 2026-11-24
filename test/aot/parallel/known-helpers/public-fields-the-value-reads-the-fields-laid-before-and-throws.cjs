// STATISTIC: KnownHelperCalls >= 6
"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const said = [];
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name; } };
const show = (o) => JSON.stringify(Object.getOwnPropertyDescriptors(o));
const p = +(process.argv[2] ?? 3);
class P { constructor(x) { __publicField(this, "x", x); __publicField(this, "twice", this.x * 2); __publicField(this, "z", x > 100 ? 0 : (() => { throw new RangeError("no"); })()); __publicField(this, "never", 1); } }
let kept; class Q { constructor(x) { kept = this; __publicField(this, "x", x); __publicField(this, "z", (() => { throw new RangeError("no"); })()); } }
said.push(attempt(() => show(new P(p))), show(new P(p + 200)), attempt(() => new Q(p)), show(kept));
console.log(said.join(" | "));
