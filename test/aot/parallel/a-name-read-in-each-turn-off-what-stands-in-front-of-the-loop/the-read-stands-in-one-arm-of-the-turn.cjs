"use strict";
const holders = JSON.parse('[{"port":5},null]'), flags = JSON.parse("[true,false]");
function sum(holder, reads) { let s = 0; for (let i = 0; i < 40; i++) { if (reads) s += holder.port * 2; else s += 1; } return s; }
const found = { sum }[JSON.parse('"sum"')];
for (let t = 0; t < 2000; t++) found(holders[0], flags[0]);
console.log(found(holders[0], flags[0]), found(holders[2], flags[1]), found(holders[1], flags[1]));
try { found(holders[2], flags[0]); } catch (e) { console.log(e instanceof TypeError); }
