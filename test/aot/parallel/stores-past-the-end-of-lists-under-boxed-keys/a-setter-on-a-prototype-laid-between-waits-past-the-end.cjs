// STATISTIC: UntypedKeyStoresAppendingInline >= 1
"use strict";
const ids = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13]");

const list = []; let caught = 0; const between = Object.create(Array.prototype); Object.defineProperty(between, 9, { set(v) { caught += v; }, get() { return "g"; }, configurable: true });
function put(key, v) { list[key] = v; return list.length; }
function step(r) { if (r === 5) Object.setPrototypeOf(list, between); return put(ids[r], r) + ":" + caught + ":" + String(list[9]); }
const out = []; for (let r = 0; r < 14; r++) out.push(String(step(r))); console.log(out.join(" "));
