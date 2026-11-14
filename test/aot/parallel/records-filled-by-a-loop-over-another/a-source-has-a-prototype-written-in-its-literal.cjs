// STATISTIC: FlowAppendedFields >= 3
"use strict";
function copy(from) { const to = {}; for (const name in from) to[name] = from[name]; return to; }
function tell(made) { let names = ""; for (const name in made) names += name + "=" + made[name] + ","; return names; }
const out = [];
for (let round = 0; round < 40; round++) {
  const a = copy({ pad: round, shade: 2 }), b = copy({ shade: 3, pad: round + 1 }), c = copy({ pad: "w" + round, shade: null });
  out.push(a.pad + b.pad + c.pad.length, tell(a), tell(b), tell(c), "row" in a, a.row, c.shade);
}
for (const word of (out.slice(-7).join(" ") + " " + out.length).split(" ")) console.log("SAID", word);
const base = { inherited: 7 };
const listed = ["pad", "shade", "row", "inherited", "extra", "0", "_pad"];
function readPad(made) { return made.pad; } function readShade(made) { return made.shade; } function readRow(made) { return made.row; } function readInherited(made) { return made.inherited; } function readExtra(made) { return made.extra; } function readZero(made) { return made[0]; } function readRenamed(made) { return made._pad; }
function word(v) { return typeof v + ":" + (typeof v === "object" && v ? "object" : Object.is(v, -0) ? "-0" : String(v)); }
function show(tag, made) { console.log("SAID", tag, "keys", Object.keys(made).join("+") || "none"); for (const name of Object.keys(made)) console.log("SAID", tag, "holds", name, word(made[name])); for (const name of listed) { console.log("SAID", tag, "in", name, name in made); console.log("SAID", tag, "own", name, Object.hasOwn(made, name)); } [readPad, readShade, readRow, readInherited, readExtra, readZero, readRenamed].forEach(read => console.log("SAID", tag, read.name, word(read(made)))); }
{  let got; try { got = copy({ __proto__: base, pad: 1, shade: 2 }); } catch (error) { got = { threw: error.constructor.name }; } show("odd", got); show("near", copy({ pad: 5, shade: 6 })); }
