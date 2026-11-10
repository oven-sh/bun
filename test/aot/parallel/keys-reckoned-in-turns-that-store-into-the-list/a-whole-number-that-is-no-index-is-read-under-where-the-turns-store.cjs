"use strict";
function spread(list, step, turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { const found = list[turn * step + 1]; list[turn] = (found === undefined ? -1 : found) + 0.5; sum += list[turn]; } return sum + ":" + list.join(); }
function fresh() { return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5]; }
const turns = +process.argv[2] || 40; let out = "";
for (let turn = 0; turn < turns; turn++) out = spread(fresh(), 1 + (turn & 1), 6);
out += "\n0:" + spread(fresh(), 0, 5);
out += "\n-0:" + spread(fresh(), -0, 5);
out += "\n-1:" + spread(fresh(), -1, 5);
out += "\n-2:" + spread(fresh(), -2, 5);
out += "\n3:" + spread(fresh(), 3, 5);
out += "\n11:" + spread(fresh(), 11, 5);
out += "\n12:" + spread(fresh(), 12, 5);
out += "\n2 ** 31:" + spread(fresh(), 2 ** 31, 5);
out += "\n2 ** 32:" + spread(fresh(), 2 ** 32, 5);
out += "\n2 ** 53:" + spread(fresh(), 2 ** 53, 5);
out += "\n1e300:" + spread(fresh(), 1e300, 5);
out += "\n-1e300:" + spread(fresh(), -1e300, 5);
out += "\nInfinity:" + spread(fresh(), Infinity, 5);
out += "\n-Infinity:" + spread(fresh(), -Infinity, 5);
{ const named = fresh(); named["-1"] = 700.5; named["NaN"] = 800.5; named["Infinity"] = 900.5; named["4294967297"] = 600.5; out += "\nnamed:" + spread(named, -2, 3) + "|" + spread(named, Infinity, 3) + "|" + spread(named, 4294967296, 3); }
{ const holed = fresh(); delete holed[3]; delete holed[5]; out += "\nholes:" + spread(holed, 2, 5); }
console.log(out);
