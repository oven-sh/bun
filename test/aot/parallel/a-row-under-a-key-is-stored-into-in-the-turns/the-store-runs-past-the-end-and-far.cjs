"use strict";
// The head of the loop reads the row (`i < data[w].length`) and the holder comes out of JSON.parse, so that the row under the key is asked for in front. HERE: the store runs past the end, once far.
function show(label, v) { console.log("SAID " + label + " " + (typeof v === "object" && v !== null ? JSON.stringify(v, (k, x) => (typeof x === "object" && x !== null && k !== "" && x === v ? "SELF" : x)) : String(v))); }
const tried = (run) => { try { return run(); } catch (e) { return "threw " + e.constructor.name; } };
function zqRow(data, w, n, far) { let s = 0; for (let i = 0; i < data[w].length && i < n; i++) { s = s + data[w][i]; data[w][i === 3 ? far : i] = data[w][i] + 2; } return s; }
for (let t = 0; t < 3; t++) { const d = JSON.parse('{"k":[1,2,3,4,5,6,7,8]}'); show("sum", zqRow(d, JSON.parse('"k"'), 8, JSON.parse("100000"))); show("length", d.k.length); show("head", d.k.slice(0, 9)); show("far", d.k[100000]); }
