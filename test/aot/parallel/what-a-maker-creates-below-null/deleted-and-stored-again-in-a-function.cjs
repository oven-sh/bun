"use strict";
const n = Number(process.argv[2] ?? 3);
function shuffled(i) { const r = Object.create(null); r.a = i; r.b = 2; r.c = 3; if (i & 1) { delete r.a; r.a = 4; } if (i & 2) { delete r.b; } const listed = []; for (const key in r) listed.push(key); return listed.join() + "|" + JSON.stringify(r) + "|" + ("b" in r); }
let out = "";
for (let i = 0; i < 8; i++) out += shuffled(i) + " ";
console.log(out, shuffled(n));
