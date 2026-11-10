"use strict";
// The head of the loop reads the row (`i < data[w].length`) and the holder comes out of JSON.parse, so that the row under the key is asked for in front. HERE: the holder is a list that holds itself at the key: the store at i == w lays something else under the key.
function show(label, v) { console.log("SAID " + label + " " + (typeof v === "object" && v !== null ? JSON.stringify(v, (k, x) => (typeof x === "object" && x !== null && k !== "" && x === v ? "SELF" : x)) : String(v))); }
const tried = (run) => { try { return run(); } catch (e) { return "threw " + e.constructor.name; } };
function zqRow(data, w) { let s = 0; for (let i = 0; i < data[w].length; i++) { s = s + data[w][i]; data[w][i] = data[w][i] + 2; } return s; }
for (let t = 0; t < 3; t++) { const d = JSON.parse("[1,2,3,4,5,6,7,8]"); d[3] = d; show("sum", tried(() => zqRow(d, JSON.parse("3")))); show("third", typeof d[3]); show("first", d[0]); }
