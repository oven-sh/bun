"use strict";
const rows = JSON.parse(process.argv[2] ?? '[{"v":1},{"v":2},{"v":3,"w":1},{"v":4.5}]');
function sum(count) { let total = 0; for (let place = 0; place < count; place++) total = total + rows[place].v; return total; }
console.log("SAID", sum(4), sum(2), sum(0));
try { console.log("SAID", sum(5)); } catch (error) { console.log("SAID", error.name); }
