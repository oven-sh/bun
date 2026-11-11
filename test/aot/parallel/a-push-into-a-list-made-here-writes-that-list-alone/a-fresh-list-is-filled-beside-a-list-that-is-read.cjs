// STATISTIC: LocalArrayMethodEffectsNarrowed >= 1
"use strict";
// The everyday form: a loop reads a list from in front and pushes into a list made here. The list read holds doubles, whole numbers, holes, texts; the list filled passes from whole numbers to doubles to values, and grows past its vector many times.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
function averages(d, w) { const out = []; let sum = 0; for (let i = 0; i < d.length; i++) { sum += d[i]; if (i >= w) sum -= d[i - w]; if (i >= w - 1) out.push(sum / w); } return out.length + " " + out[out.length - 1] + " " + out[0]; }
function evens(d) { const out = []; for (let i = 0; i < d.length; i++) { if ((d[i] & 1) === 0) out.push(d[i]); } return out.length + " " + out.join("").length; }
function pairs(d) { const out = []; for (let i = 0; i < d.length; i++) out.push(d[i], i); return out.length + " " + out[out.length - 2]; }
function mixed(d) { const out = []; for (let i = 0; i < d.length; i++) out.push(i < 3 ? i : i < 6 ? d[i] + 0.5 : String(d[i])); return out.join("|").length; }
for (let round = 0; round < 3; round++) {
    const doubles = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => (i * 53 % 97) / 4).join() + "]"), whole = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => i * 7 & 255).join() + "]");
    for (const list of [doubles, whole, doubles.slice(0, 3), [], whole.slice(0, 1)]) said.push(averages(list, 5), evens(list), pairs(list), mixed(list));
    const holed = whole.slice(); delete holed[7]; delete holed[100]; said.push(averages(holed, 5), evens(holed), pairs(holed), mixed(holed));
    const texts = whole.slice(); texts[9] = veil("x"); said.push(averages(texts, 5).length, evens(texts), pairs(texts), mixed(texts));
}
console.log(said.join(" "));
