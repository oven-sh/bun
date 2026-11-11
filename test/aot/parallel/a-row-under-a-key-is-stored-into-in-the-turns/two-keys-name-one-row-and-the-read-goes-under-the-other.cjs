"use strict";
// The head of the loop reads the row (`i < data[w].length`) and the holder comes out of JSON.parse, so that the row under the key is asked for in front. HERE: two keys name one row; the store goes into the row of the head, one ahead, and the sum is read under the other key.
function show(label, v) { console.log("SAID " + label + " " + (typeof v === "object" && v !== null ? JSON.stringify(v, (k, x) => (typeof x === "object" && x !== null && k !== "" && x === v ? "SELF" : x)) : String(v))); }
const tried = (run) => { try { return run(); } catch (e) { return "threw " + e.constructor.name; } };
function zqRow(data, w, v) { let s = 0; for (let i = 0; data[w].length > i + 1; i++) { s = s + data[v][i]; data[w][i + 1] = data[w][i] + 2; } return s; }
for (let t = 0; t < 3; t++) { const d = JSON.parse('{"a":[1,1,1,1,1,1,1,1]}'); d.b = d.a; show("sum", zqRow(d, JSON.parse('"a"'), JSON.parse('"b"'))); show("row", d.a); }
