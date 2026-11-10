// STATISTIC: UntypedKeyStoresAppendingInline >= 1
"use strict";
const ids = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13]");

const links = [];
function linksOf(node) { return links[node.id] || (links[node.id] = { of: node.id, asked: 0 }); }
function step(r) { const l = linksOf({ id: ids[r >> 1] }); l.asked++; return l.of + ":" + l.asked + ":" + links.length; }
const out = []; for (let r = 0; r < 14; r++) out.push(String(step(r))); console.log(out.join(" "));
