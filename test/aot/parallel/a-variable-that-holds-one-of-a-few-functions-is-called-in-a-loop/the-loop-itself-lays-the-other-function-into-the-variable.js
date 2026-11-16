"use strict";
function up(a, b) { return (a + b) | 0; }
function down(a, b) { return (a - b) | 0; }
let step = down;
if (process.argv.length > 0) step = up;
function total(t) { let s = 0; for (let i = 0; i < 16; i++) { if (i === 5) step = down; if (i === 9 + (t & 1)) step = up; s = (s + step(i, t)) | 0; } return s; }
const out = [];
for (let t = 0; t < 6; t++) out.push(total(t));
console.log(out.join(" "), step === up, step === down);
