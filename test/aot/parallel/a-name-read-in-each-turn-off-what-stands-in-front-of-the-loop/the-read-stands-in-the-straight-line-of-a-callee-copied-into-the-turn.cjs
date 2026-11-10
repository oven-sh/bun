// STATISTIC: ReadsThatAskTheirSitesBuiltInFrontOfLoops >= 2
"use strict";
const holders = JSON.parse('[{"limits":{"port":5}},{"limits":null},null]');
function part(holder) { return holder.limits.port * 2; }
function sum(holder) { let s = 0; for (let i = 0; i < 40; i++) s += part(holder); return s; }
const found = { sum }[JSON.parse('"sum"')];
for (let t = 0; t < 2000; t++) found(holders[0]);
console.log(found(holders[0]));
for (const at of [1, 2, 3]) { try { found(holders[at]); } catch (e) { console.log(e instanceof TypeError, e.message); } }
