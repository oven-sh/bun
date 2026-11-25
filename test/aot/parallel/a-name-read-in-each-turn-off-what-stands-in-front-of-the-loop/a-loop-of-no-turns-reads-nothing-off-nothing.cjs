"use strict";
const holders = JSON.parse('[{"port":5},null]'), flags = JSON.parse("[true,false]");
function sum(holder, goes) { let s = 0; for (let i = 0; goes && i < 40; i++) s += holder.port * 2; return s; }
const found = { sum }[JSON.parse('"sum"')];
for (let t = 0; t < 2000; t++) found(holders[0], flags[0]);
console.log(found(holders[2], flags[1]), found(holders[1], flags[1]), found(holders[0], flags[0]));
try { found(holders[2], flags[0]); } catch (e) { console.log(e instanceof TypeError, e.message); }
try { found(holders[1], flags[0]); } catch (e) { console.log(e instanceof TypeError, e.message); }
