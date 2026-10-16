const util = require("node:util");
const raw = { customInspect: false };
const mode = process.argv[2];
const out = [];
if (mode === "anon") { for (let i = 0; i < 5; i++) { const C = class {}; const v = new C(); v.x = i; out.push(util.inspect(v, raw)); } }
if (mode === "named") { class Point {} for (let i = 0; i < 5; i++) { const v = new Point(); v.x = i; out.push(util.inspect(v, raw)); } }
if (mode === "empty") { class Point {} for (let i = 0; i < 5; i++) { out.push(util.inspect(new Point(), raw)); } }
if (mode === "nullproto") { for (let i = 0; i < 5; i++) { const v = Object.create(null); v.x = i; out.push(util.inspect(v, raw)); } }
if (mode === "default") { class Point {} for (let i = 0; i < 5; i++) { const v = new Point(); v.x = i; out.push(util.inspect(v)); } }
console.log(mode, out[0]);
