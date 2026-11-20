"use strict";
const log = [];
const outside = JSON.parse('[1, 20, 300]');
function taken(at) { const l = JSON.parse("[0.5,1,2,3,4]"); l.push("x"); return l[at]; }
const show = r => Object.keys(r).join() + "=" + Object.keys(r).map(k => String(r[k])).join();
function several(v, k, x) { const r = { n: v }; r[8] = 1; r[0] = 1; r[1] = 2; switch (x) { case 1: case 2: case 3: case 4: r[k | 0] = x; r[(k + 1) | 0] = x; } r[8] = 2.5; return show(r); }
function one(v, k, x) { const r = { n: v }; r[8] = 1; r[0] = 1; r[1] = 2; switch (x) { case 3: r[k | 0] = x; r[(k + 1) | 0] = x; } r[8] = 2.5; return show(r); }
function whole(v, k, x) { const r = { n: v }; r[8] = 1; r[0] = 1; r[1] = 2; r[k | 0] = x | 0; r[(k + 1) | 0] = (x + 1) | 0; r[8] = 2.5; return show(r); }
for (let turn = 0; turn < 3; turn++) for (const v of outside) { const k = outside.length - 3; log.push(several(v, k, taken(3)), one(v, k, taken(3)), whole(v, k, taken(3)), several(v, k, taken(0)), several(v, k, taken(5))); }
console.log("SAID", log.join(" | "));
