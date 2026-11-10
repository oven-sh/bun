"use strict";
// The head of the loop reads the row (`i < data[w].length`) and the holder comes out of JSON.parse, so that the row under the key is asked for in front. HERE: a setter above the row, at a hole, lays another row under the key.
function show(label, v) { console.log("SAID " + label + " " + (typeof v === "object" && v !== null ? JSON.stringify(v, (k, x) => (typeof x === "object" && x !== null && k !== "" && x === v ? "SELF" : x)) : String(v))); }
const tried = (run) => { try { return run(); } catch (e) { return "threw " + e.constructor.name; } };
function zqRow(data, w) { let s = 0; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; data[w][i] = data[w][i] + 2; } return s; }
const other = JSON.parse("[100,100,100,100,100,100]");
for (let t = 0; t < 3; t++) { const d = JSON.parse('{"k":[1,2,3,4,5,6]}'); delete d.k[2]; Object.setPrototypeOf(d.k, { __proto__: Array.prototype, get 2() { return 7; }, set 2(x) { d.k = other; } }); show("sum", zqRow(d, JSON.parse('"k"'))); show("other", other); show("is", d.k === other); }
