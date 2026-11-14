// STATISTIC: FlowAppendedFields = 0
"use strict";
function copy(from) { const to = {}; for (const name in from) to[name] = from[name]; return to; }
function tell(made) { let names = ""; for (const name in made) names += name + "=" + made[name] + ","; return names; }
const out = [];
for (let round = 0; round < 40; round++) {
  const a = copy({ pad: round, shade: 2 }), b = copy({ row: round, at: 1, more: 2 }), c = copy({ words: "w" + round });
  out.push(a.pad + b.row + c.words.length, tell(a), tell(b), tell(c), "row" in a, a.row, b.pad, c.at, "more" in b);
}
console.log(out.slice(-9).join(" "), out.length);
