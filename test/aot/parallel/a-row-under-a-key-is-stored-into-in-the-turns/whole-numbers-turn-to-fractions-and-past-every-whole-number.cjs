"use strict";
// The head of the loop reads the row (`i < data[w].length`) and the holder comes out of JSON.parse, so that the row under the key is asked for in front. HERE: whole numbers turn to fractions, then past every whole number, by a written factor.
function show(label, v) { console.log("SAID " + label + " " + (typeof v === "object" && v !== null ? JSON.stringify(v, (k, x) => (typeof x === "object" && x !== null && k !== "" && x === v ? "SELF" : x)) : String(v))); }
const tried = (run) => { try { return run(); } catch (e) { return "threw " + e.constructor.name; } };
function zqRow(data, w) { let s = 0; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; data[w][i] = data[w][i] * 1.5e150 - 0.25; } return s; }
for (let t = 0; t < 1; t++) { const d = JSON.parse('{"k":[1,2,3,4,0,6,7,8]}'); show("sum", zqRow(d, JSON.parse('"k"'))); show("again", zqRow(d, JSON.parse('"k"'))); show("third", zqRow(d, JSON.parse('"k"'))); show("row", d.k); }
