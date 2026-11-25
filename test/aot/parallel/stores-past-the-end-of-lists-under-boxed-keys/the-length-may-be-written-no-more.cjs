// STATISTIC: UntypedKeyStoresAppendingInline >= 1
"use strict";
const ids = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13]");

const list = [];
function put(key, v) { try { list[key] = v; return list.length; } catch (e) { return e.constructor.name; } }
function step(r) { if (r === 7) Object.defineProperty(list, "length", { writable: false }); return put(ids[r], r) + ":" + put(ids[r >> 1], -r); }
const out = []; for (let r = 0; r < 14; r++) out.push(String(step(r))); console.log(out.join(" "));
