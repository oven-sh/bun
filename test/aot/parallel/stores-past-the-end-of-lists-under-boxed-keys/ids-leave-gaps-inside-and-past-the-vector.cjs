// STATISTIC: UntypedKeyStoresAppendingInline >= 1
"use strict";
const ids = JSON.parse("[0,3,1,9,2,30,31,5,200,201,7,5000,5001,4]");
const links = [];
function put(id, v) { links[id] = v; return links.length; }
function step(r) { return put(ids[r], { r }) + ":" + Object.keys(links).length + ":" + (2 in links) + (links[ids[r] - 1] === undefined); }
const out = []; for (let r = 0; r < 14; r++) out.push(String(step(r))); console.log(out.join(" "));
