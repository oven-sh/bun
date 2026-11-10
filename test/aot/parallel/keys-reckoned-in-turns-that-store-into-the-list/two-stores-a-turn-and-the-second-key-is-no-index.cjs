"use strict";
// `list[at] += 1; list[at - by] += 1`: the first store is done when the second key is reckoned.
function bump(list, steps) { for (let at = 0; at < steps.length; at++) { const by = steps[at].by; list[at] = list[at] + 1; list[at - by] = list[at - by] + 1; } return Object.keys(list).map(key => key + "=" + list[key]).join(","); }
function steps(a, b, c, d) { return [{ by: a }, { by: b }, { by: c }, { by: d }]; }
function fresh() { return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]; }
const turns = +process.argv[2] || 40; let out = "";
for (let turn = 0; turn < turns; turn++) out = bump(fresh(), steps(0, 1, 1, 2));
out += "\n" + bump(fresh(), steps(0, 0.5, 1, 2.5));
out += "\n" + bump(fresh(), steps(0.5, 0.5, 0.5, 0.5));
out += "\n" + bump(fresh(), steps(0, 5, 1, -9));
out += "\n" + bump(fresh(), steps(-0, NaN, 1, Infinity));
console.log(out);
