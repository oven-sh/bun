"use strict";
const holders = JSON.parse('[{"size":5},null,null,null]'), flags = JSON.parse("[false,true]");
holders[1] = new Map(); holders[2] = new Map([[1, 1]]); holders[3] = new Set([1, 2]);
function sum(holder, grows) { let s = 0; for (let i = 0; i < 40; i++) { s += holder.size * 2; if (grows) holder.set(i, i); } return s; }
function still(holder) { let s = 0; for (let i = 0; i < 40; i++) s += holder.size * 2; return s; }
const found = { sum, still }, names = JSON.parse('["sum","still"]');
for (let t = 0; t < 2000; t++) found[names[0]](holders[0], flags[0]) + found[names[1]](holders[0]);
console.log(found[names[0]](holders[0], flags[0]), found[names[0]](holders[1], flags[1]), found[names[1]](holders[2]), found[names[1]](holders[3]), found[names[1]](holders[0]));
