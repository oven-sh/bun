// STATISTIC: OrdinaryObjectStorageReadsHoisted >= 3
// A plain object that a loop reads under numbers: where its elements lie, and how many, is asked in front of the loop.
const out = [];
const whole = {}, halves = {}, holes = {}, named = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }, below = Object.create({ 12: 100 }), sparse = {}, grown = {}, texts = {};
for (let i = 0; i < 10; i++) whole[i] = i * 2;
for (let i = 0; i < 10; i++) halves[i] = i + 0.5;
for (let i = 0; i < 10; i++) holes[i] = i;
for (let i = 0; i < 10; i++) named[i] = i * 3;
for (let i = 0; i < 10; i++) below[i] = i;
for (let i = 0; i < 10; i++) sparse[i] = i;
for (let i = 0; i < 10; i++) grown[i] = i;
for (let i = 0; i < 10; i++) texts[i] = `t${i}`;
delete holes[4];
sparse[200000] = 5;
function sumOfWhole(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) { n += whole[k % 10]; }
  return n;
}
function sumOfHalves(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) { n += halves[k % 10]; }
  return n;
}
function sumOfHoles(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) { n += holes[k % 10]; }
  return n;
}
function sumOfNamed(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) { n += named[k % 10]; }
  return n;
}
function sumPastEnd(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) { n += below[k % 13] ?? 0; }
  return n;
}
function sumOfSparse(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) { n += sparse[k % 10]; }
  return n;
}
function sumOfGrown(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) {
    n += grown[k % 10];
    if (k === 25) for (let g = 10; g < 80; g++) grown[g] = g;
    if (k === 45) grown[k % 10] = 0.25;
    if (k === 65) grown.late = grown.later = grown.latest = grown.last = k;
  }
  return n;
}
function textOfTexts(turns) {
  let n = "";
  for (let k = 0; k < turns; k++) { n += texts[k % 10]; }
  return n;
}
out.push(sumOfWhole(400000), sumOfHalves(400000), sumOfHoles(40), sumOfNamed(4000), sumPastEnd(4000), sumOfSparse(4000), sumOfGrown(100), textOfTexts(12));
console.log(out.join("\n"));
