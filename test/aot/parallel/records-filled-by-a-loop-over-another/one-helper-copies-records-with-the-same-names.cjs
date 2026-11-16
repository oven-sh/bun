// STATISTIC: FlowAppendedFields >= 2
// STATISTIC: FieldsOutOfLine = 0
"use strict";
function copy(from) { const to = {}; for (const name in from) to[name] = from[name]; return to; }
function tell(made) { let names = ""; for (const name in made) names += name + "=" + made[name] + ","; return names; }
const out = [];
for (let round = 0; round < 40; round++) {
  const a = copy({ pad: round, shade: 2 }), b = copy({ shade: 3, pad: round + 1 }), c = copy({ pad: "w" + round, shade: null });
  out.push(a.pad + b.pad + c.pad.length, tell(a), tell(b), tell(c), "row" in a, a.row, c.shade);
}
console.log(out.slice(-7).join(" "), out.length);
