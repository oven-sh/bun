"use strict";
// The head of the loop reads the row (`i < data[w].length`) and the holder comes out of JSON.parse, so that the row under the key is asked for in front. HERE: -0 goes in: the row of whole numbers must keep its sign.
function show(label, v) { console.log("SAID " + label + " " + (typeof v === "object" && v !== null ? JSON.stringify(v, (k, x) => (typeof x === "object" && x !== null && k !== "" && x === v ? "SELF" : x)) : String(v))); }
const tried = (run) => { try { return run(); } catch (e) { return "threw " + e.constructor.name; } };
function zqRow(data, w) { let s = 0; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; data[w][i] = data[w][i] * -0; } return s; }
for (let t = 0; t < 2; t++) { const d = JSON.parse('{"k":[1,2,3,4]}'); show("sum", zqRow(d, JSON.parse('"k"'))); show("signs", d.k.map((x) => 1 / x).join()); }
