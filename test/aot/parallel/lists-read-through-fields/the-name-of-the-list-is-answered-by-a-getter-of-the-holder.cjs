"use strict";
let asked = 0;
const lists = JSON.parse(process.argv[2] ?? "[[1,2,3],[4,5,6],[7,8,9]]");
const shelf = { get rows() { return lists[asked++ % lists.length]; } };
function sum(start) { let total = start; for (let place = 0; place < shelf.rows.length; place++) total = total + shelf.rows[place]; return total; }
console.log("SAID", sum(0), asked);
console.log("SAID", sum(0), asked);
