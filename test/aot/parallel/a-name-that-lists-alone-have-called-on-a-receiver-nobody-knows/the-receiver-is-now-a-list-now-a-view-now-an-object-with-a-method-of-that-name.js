"use strict";
const kinds = [JSON.parse("[1,2,3]"), new Uint8Array([250, 2, 3]), { map(f) { return [f(10), "mine"]; } }, [1, 2, 3].values(), { map: JSON.parse("null") }];
function twice(x) { return x.map(v => v * 2); }
function show(r) { return Array.isArray(r) ? "list " + r.join() : ArrayBuffer.isView(r) ? "view " + r.join() : typeof r.next === "function" ? "steps " + [...r].join() : String(r); }
const out = [];
for (let t = 0; t < 60; t++) { try { out.push(show(twice(kinds[t % kinds.length]))); } catch (error) { out.push(error.constructor.name); } }
console.log(out.slice(0, 5).join(" | "), out.length, new Set(out).size);
