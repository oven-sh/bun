"use strict";
function work(a, w, n) { let s = 0, turns = 0; for (let i = 0; i < n; i++) { turns++; s += a[i] * w[0] + w[1]; } return s + "/" + turns; }
const tools = { work };
const a = JSON.parse("[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5,12.5]");
for (let call = 0; call < 3; call++) { const w = JSON.parse("[2.5,0.5,4.5]"); console.log("SAID", tools[JSON.parse('"work"')](a, w, JSON.parse("12")), tools[JSON.parse('"work"')](a, w, JSON.parse("0")), w.join()); }
