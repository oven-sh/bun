// STATISTIC: KnownHelperCalls = 0
"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const said = [];
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name; } };
const show = (o) => JSON.stringify(Object.getOwnPropertyDescriptors(o));
const p = +(process.argv[2] ?? 3);
class P { constructor(x) { __publicField(this, "x", x); } }
said.push(show(new P(p)));
__publicField = (obj, key, value) => { obj["other " + key] = value; };
said.push(show(new P(p)));
console.log(said.join(" | "));
