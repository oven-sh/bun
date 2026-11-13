// STATISTIC: KnownHelperCalls >= 2
"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const said = [];
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name; } };
const show = (o) => JSON.stringify(Object.getOwnPropertyDescriptors(o));
const p = +(process.argv[2] ?? 3);
class P { constructor(x) { __publicField(this, "x", x); __publicField(this, "n", 1); } }
let s = 0; for (let i = 0; i < 100; i++) s += new P(i + p).x + new P(i).n;
said.push(s, show(new P(p)), Object.keys(new P(1)).join());
console.log(said.join(" | "));
