// Loops that step their counter several times in one iteration, with second counters beside it that step by as many: inside their views, at their ends and past them.
// STATISTIC: StepsOfIterationHeldBelowRoom >= 8
// STATISTIC: SecondCountersOfMultiplesGuarded >= 1
"use strict";
function weave(line, high, low, count) {
  let from = 0;
  for (let at = 0; at < count; from += 2) {
    line[at++] = high[from];
    line[at++] = low[from + 1];
    line[at++] = high[from] ^ low[from];
    line[at++] = 255;
  }
  return from;
}
function spread(wide, narrow, count) {
  for (let at = 0, to = 0; at < count; to += 3) {
    const note = narrow[at++];
    wide[to] = note & 7;
    wide[to + 1] = (note >> 3) & 7;
    wide[to + 2] = note >> 6;
  }
}
function join(narrow, wide, count) {
  let sum = 0;
  for (let at = 0; at < count;) {
    let note = wide[at++];
    note |= wide[at++] << 3;
    note |= wide[at++] << 6;
    narrow[at / 3 - 1] = note;
    sum += note;
  }
  return sum;
}
function strip(dots, inks, count) {
  for (let at = 0, from = 0; at < count; at += 4, from += 3) {
    dots[at] = inks[from];
    dots[at + 1] = inks[from + 1];
    dots[at + 2] = inks[from + 2];
    dots[at + 3] = 255;
  }
}
function pairs(dots, inks, count) {
  for (let at = 0, from = 0; at < count; at += 2, from += 5) dots[at] = inks[from] + 1;
}
function echo(line, count) {
  for (let at = 2, back = 0; at < count; back += 2) {
    line[at++] += line[back];
    line[at++] -= line[back + 1];
  }
}
function notes(count, by) {
  const view = new Uint8Array(count);
  for (let at = 0; at < count; at++) view[at] = at * by + 3;
  return view;
}
for (let round = 0; round < 30; round++) {
  const line = new Uint8Array(32);
  const from = weave(line, notes(17, round), notes(17, 5), 32);
  const wide = new Uint8Array(33);
  spread(wide, notes(11, round), 11);
  const narrow = new Int16Array(11);
  const sum = join(narrow, wide, 33);
  echo(line, 32);
  const dots = new Uint8Array(24);
  strip(dots, notes(18, round), 24);
  pairs(dots, notes(60, round), 22);
  if (round % 10 === 1) console.log(dots.join());
  if (round % 10 === 0) console.log(from, line.join(), wide.join(), narrow.join(), sum);
}
const line = new Uint8Array(13);
console.log(weave(line, notes(4, 9), notes(5, 2), 13), line.join());
console.log(weave(line, notes(40, 9), notes(40, 2), 30), line.join());
const wide = new Uint8Array(10);
spread(wide, notes(5, 31), 7);
console.log(wide.join(), join(new Uint8Array(2), wide, 12), join([], wide, 9));
const dots = new Uint8Array(10);
strip(dots, notes(7, 40), 16);
console.log(dots.join());
strip(dots, notes(5, 11), 10);
console.log(dots.join());
strip(dots, notes(30, 2), -3);
pairs(dots, notes(12, 3), 9);
console.log(dots.join());
const list = [];
console.log(weave(list, [1, 2, 3, 4, 5], [9, 8, 7], 11), list.map(String).join(), list.length);
const floats = new Float32Array(12);
console.log(weave(floats, new Float64Array([0.5, 1.5, -2]), notes(9, 3), 8), floats.join());
const odd = new Int8Array(9).map((_, at) => at * 30);
echo(odd, 9);
console.log(odd.join());
const gone = new Uint8Array(new ArrayBuffer(16, { maxByteLength: 16 }));
gone.buffer.resize(6);
console.log(weave(gone, notes(9, 1), notes(9, 1), 16), gone.join());
