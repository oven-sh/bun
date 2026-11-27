"use strict";
let calls = 0;
function up(a, b) { calls++; return (a + b) | 0; }
function down(a, b) { calls++; return (a - b) | 0; }
function swap() { step = step === up ? down : up; }
let step = down;
if (process.argv.length > 0) step = up;
function total(t) { let s = 0; for (let i = 0; i < 16; i++) { s = (s + step(i, t)) | 0; if ((calls & 3) === 3) swap(); } return s; }
const out = [];
for (let t = 0; t < 6; t++) out.push(total(t));
console.log(out.join(" "), calls, step === up);
