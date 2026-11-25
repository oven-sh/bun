// STATISTIC: KnownHelperCalls >= 2
"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const said = [];
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name; } };
const show = (o) => JSON.stringify(Object.getOwnPropertyDescriptors(o));
const p = +(process.argv[2] ?? 3);
const log = [];
class B { constructor() { return new Proxy({}, { has(t, k) { log.push("has " + String(k)); return k in t; }, set(t, k, v, r) { log.push("set " + String(k)); return Reflect.set(t, k, v, r); }, defineProperty(t, k, d) { log.push("define " + String(k)); return Reflect.defineProperty(t, k, d); }, getOwnPropertyDescriptor(t, k) { log.push("describe " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); } }); } }
class P extends B { constructor(x) { super(); __publicField(this, "x", x); __publicField(this, "x", x + 1); } }
said.push(new P(p).x, log.join());
console.log(said.join(" | "));
