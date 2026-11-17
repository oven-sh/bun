// STATISTIC: UntypedKeyStoresAppendingInline >= 1
"use strict";
const ids = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13]");

const list = [];
function put(key, v) { list[key] = v; return list.length; }
function step(r) { if (r === 8) list.length = 2; const k = r < 8 ? ids[r] : ids[r - 6]; return put(k, { r }) + ":" + JSON.stringify(list[k - 1] === undefined ? null : list[k - 1]) + ":" + Object.keys(list).length; }
const out = []; for (let r = 0; r < 14; r++) out.push(String(step(r))); console.log(out.join(" "));
