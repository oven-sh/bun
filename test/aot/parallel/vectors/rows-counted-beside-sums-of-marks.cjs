// Rows that are computed side by side, in a loop that sums integers, carries numbers and passes others on.
"use strict";
function ease(now, next, height, width, pull) {
  let changed = 0;
  let last = 0.5;
  for (let y = 1; y < height - 1; y++) {
    const above = now[y - 1];
    const row = now[y];
    const below = now[y + 1];
    const out = next[y];
    changed += y & 3;
    for (let x = 1; x < width - 1; x++) out[x] = row[x] + (above[x] + below[x] - 2 * row[x]) * pull;
    last = last / 2 + out[1];
  }
  return changed + ":" + last;
}
function drift(cells, width, height, by) {
  let marks = 0;
  let passed = by;
  for (let y = 1; y <= height; y++) {
    let at = y * width;
    marks = (marks * 3 + y) | 0;
    for (let x = 1; x < width; x++) {
      at++;
      cells[at] = (cells[at - width] + cells[at] * 2 + passed) / 4;
    }
    passed += 0.125;
  }
  return marks + ":" + passed;
}
function rows(height, width, kind) {
  const list = [];
  for (let y = 0; y < height; y++) {
    const row = new kind(width);
    for (let x = 0; x < width; x++) row[x] = ((x * 7 + y * 5) % 13) / 2;
    list.push(row);
  }
  return list;
}
const text = list => list.map(row => Array.from(row, number => (typeof number === "number" ? Math.round(number * 1000) / 1000 : String(number))).join()).join(" / ");
for (const kind of [Float64Array, Float32Array, Array]) {
  for (const [height, width] of [[3, 3], [6, 9], [7, 12], [10, 5], [2, 8], [9, 2]]) {
    let now = rows(height, width, kind);
    let next = rows(height, width, kind);
    let told = "";
    for (let round = 0; round < 6; round++) {
      told = ease(now, next, height, width, 0.2);
      [now, next] = [next, now];
    }
    console.log(kind.name, height, width, told, text(now).length < 400 ? text(now) : text(now).slice(0, 200));
  }
}
for (const [width, height] of [[4, 3], [9, 6], [17, 5], [2, 2], [1, 4]]) {
  const view = new Float64Array(width * (height + 1)).map((_, at) => (at * 11) % 17);
  const list = Array.from(view);
  let told = "";
  for (let round = 0; round < 4; round++) told = drift(view, width, height, round) + " " + drift(list, width, height, round);
  console.log(width, height, told, view.join() === list.join(), text([view]).slice(0, 160));
}
const same = rows(6, 7, Float64Array);
console.log(ease(same, same, 6, 7, 0.25), text(same));
const twice = rows(6, 7, Float64Array);
twice[3] = twice[2];
console.log(ease(twice, rows(6, 7, Float64Array), 6, 7, 0.25), ease(rows(6, 7, Float64Array), twice, 6, 7, 0.25), text(twice));
const odd = rows(6, 7, Array);
odd[2][3] = "4";
odd[4][5] = undefined;
delete odd[1][2];
const out = rows(6, 7, Array);
console.log(ease(odd, out, 6, 7, 0.5), text(out));
const ints = rows(5, 6, Float64Array);
ints[2] = new Int16Array(6).fill(9);
const into = rows(5, 6, Float64Array);
into[1] = new Uint8Array(6);
console.log(ease(ints, into, 5, 6, 0.5), text(into));
console.log(drift(new Float64Array(10), 4, 5, 1), drift([1, 2, 3, 4, 5], 2, 3, NaN), drift(new Float32Array(30).fill(1e30), 6, 4, 2));
