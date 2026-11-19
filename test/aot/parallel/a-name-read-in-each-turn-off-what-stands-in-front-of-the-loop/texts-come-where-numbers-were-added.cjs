"use strict";
const holders = JSON.parse('[{"a":1,"b":2},{"a":"x","b":"y"},{"a":1,"b":"y"},{"a":"x","b":2}]');
function join(holder) { let s = 0; for (let i = 0; i < 40; i++) s += holder.a + holder.b; return s; }
const found = { join }[JSON.parse('"join"')];
for (let t = 0; t < 2000; t++) found(holders[0]);
console.log(found(holders[0]), found(holders[1]).slice(0, 9), found(holders[2]).slice(0, 9), found(holders[3]).slice(0, 9));
