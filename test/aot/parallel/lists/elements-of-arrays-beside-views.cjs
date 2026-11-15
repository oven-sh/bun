// STATISTIC: ArrayAccessesSplitByKind >= 2
// STATISTIC: CallbackChainsFused >= 1
// A parameter holds an array in some calls and a typed array in others: what the array's elements are stays known.
"use strict";
const out = [];
function list(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push((i * 37) & 127);
  return a;
}
function mix(x, a, b, c) {
  x[a] = (x[a] + x[b]) & 127;
  x[c] = (x[c] ^ x[a]) & 127;
  x[b] = (x[b] + x[c]) & 127;
}
function rounds(h) {
  for (let i = 0; i < 4; i++) {
    mix(h, 0, 4, 8);
    mix(h, 1, 5, 9);
    mix(h, i, 6, 10);
  }
  return h[3];
}
function total(h) {
  let s = 0;
  h.forEach(x => {
    s = (s + x) | 0;
  });
  return s + h.reduce((a, x) => (a + x) | 0, 0);
}
class Reader {
  constructor(data) {
    this.data = data;
    this.at = 0;
  }
  next() {
    const v = this.data[this.at];
    this.at = (this.at + 1) & 15;
    return v;
  }
  put(v) {
    this.data[this.at] = v;
    this.at = (this.at + 1) & 15;
  }
  size() {
    return this.data.length;
  }
}
function read(reader) {
  let s = 0;
  for (let i = 0; i < 12; i++) s = (s + reader.next()) | 0;
  for (let i = 0; i < reader.size(); i++) reader.put(i);
  return s;
}
const holders = [list(12), new Int32Array(list(16)), list(9), new Int32Array(list(4))];
const readers = holders.map(h => new Reader(h));
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < holders.length; i++) {
    out.push([rounds(holders[i]), total(holders[i]), read(readers[i])].join());
  }
}
for (const h of holders) out.push(h.constructor.name + " " + Array.from({ length: h.length }, (_, i) => String(h[i])).join());
for (const line of out) console.log(line);
