"use strict";
// The head of the loop reads the row (`i < data[w].length`) and the holder comes out of JSON.parse, so that the row under the key is asked for in front. HERE: a getter under the key gives another row each time.
function show(label, v) { console.log("SAID " + label + " " + (typeof v === "object" && v !== null ? JSON.stringify(v, (k, x) => (typeof x === "object" && x !== null && k !== "" && x === v ? "SELF" : x)) : String(v))); }
const tried = (run) => { try { return run(); } catch (e) { return "threw " + e.constructor.name; } };
function zqRow(data, w) { let s = 0; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; data[w][i] = data[w][i] + 2; } return s; }
for (let t = 0; t < 3; t++) { const rows = [JSON.parse("[1,2,3,4]"), JSON.parse("[10,20,30,40]")]; let c = 0; const d = Object.defineProperty(JSON.parse("{}"), "k", { get() { return rows[c++ & 1]; } }); show("sum", zqRow(d, JSON.parse('"k"'))); show("rows", rows); show("asked", c); }
