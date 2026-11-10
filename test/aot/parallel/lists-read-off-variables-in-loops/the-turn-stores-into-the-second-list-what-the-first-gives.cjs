"use strict";
const rows = JSON.parse(process.argv[2] ?? "[1,2,3,4]"), more = JSON.parse(process.argv[3] ?? "[0,0,0,0]");
function copy(scale) { for (let place = 0; place < rows.length; place++) more[place] = rows[place] * scale + more[place]; return more.join(); }
console.log("SAID", copy(2));
console.log("SAID", copy(0.5));
