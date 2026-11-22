"use strict";
// Lists that grow by a word an iteration: some iterations alone read tables. Between the making of a list and its loop other code may touch the list, the tables, or what the loop reads them off.
const show = list => Array.prototype.map.call(list, v => (v === undefined ? "_" : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v))).join(",");
const tables = k => ({ low: Array.from({ length: 16 }, (_, i) => (i * 11 + k) & 255), high: Array.from({ length: 16 }, (_, i) => Math.imul(i + k, 0x01000193)), steps: [1, 2, 4, 8] });

function spread(seed, box, count, between) {
  const words = [];
  for (let i = 0; i < seed.length; i++) words.push(seed[i]);
  if (between) between(words, box);
  const low = box.low, high = box.high;
  for (let at = words.length, n = 0; n < count; at++, n++) {
    let word = words[at - 1];
    if (n % 3 === 1) word = high[word & 15] ^ low[(word >>> 5) & 15];
    else if (n & 8) word += box.steps[n & 3];
    words[at] = (word << 1 | word >>> 31) ^ words[at - 2];
  }
  return words;
}
function halved(seed, box, count, between) {
  const words = seed.slice();
  if (between) between(words, box);
  for (let n = 0; n < count; n++) {
    let word = words[words.length - 1] - words[n];
    if (n > 5) word = box.low[n & 15] - word / 2;
    words.push(word);
  }
  return words;
}
function twoLists(seed, box, count, between) {
  const forward = [], backward = new Array(count);
  if (between) between(forward, box);
  for (let n = 0; n < count; n++) {
    const word = n < seed.length ? seed[n] | 0 : forward[n - 1] ^ forward[n - seed.length];
    forward[forward.length] = word;
    if (!(n & 3)) backward[count - 1 - n] = box.high[word & 7] ^ box.high[word >>> 28];
  }
  return forward.concat(backward);
}
const ways = { spread, halved, twoLists };
const seed = [0x1234567, -5, 77, 0x7fffffff, 3];
const betweens = {
  nothing: null,
  shortens: words => { words.length = Math.min(words.length, 2); },
  lengthens: words => { words[words.length + 2] = 9; },
  texts: (words, box) => { box.low[3] = "7"; box.steps[2] = "x"; },
  doubles: (words, box) => { box.high[5] = 1.5; box.low[1] = -0; words[0] = 0.25; },
  holes: (words, box) => { delete box.low[4]; delete box.high[9]; delete words[1]; },
  views: (words, box) => { box.low = new Uint8Array(box.low); box.high = new Int32Array(box.high); },
  heirs: (words, box) => { class Row extends Array {} box.steps = Row.from([5, 6, 7, 8]); },
  getters: (words, box) => { let asked = 0; Object.defineProperty(box, "steps", { get() { asked++; return [asked, 2, 3, asked]; } }); },
  bigger: (words, box) => { box.high = [2 ** 40, 2 ** 33 + 1, -(2 ** 35), ...box.high]; },
};
for (const [name, way] of Object.entries(ways)) {
  for (const [what, between] of Object.entries(betweens)) {
    let said;
    for (let round = 0; round < 3; round++) said = show(way(seed, tables(round * 5), 20 + round * 7, between));
    console.log(name, what, said);
  }
  for (const what of [words => Object.freeze(words), words => Object.defineProperty(words, 0, { set() { throw new RangeError("stored"); }, get() { return 1; }, configurable: true }), words => Object.preventExtensions(words)]) {
    try { console.log(name, show(way(seed, tables(1), 12, what))); } catch (error) { console.log(name, error.constructor.name); }
  }
}
// The list that a constructor makes is handed out in front of its loop.
let handed = [];
class Rounds {
  constructor(seed, box, count, hands) { const all = this.all = []; for (const word of seed) all.push(word); if (hands) handed.push(all); for (let n = 0; n < count; n++) { let word = this.all[all.length - 1]; if (n % 5 === 2) { word = box.high[word & 15]; if (hands && n > 10) handed[handed.length - 1].push(n); } all.push(word ^ all[n]); } }
}
for (let k = 0; k < 4; k++) console.log(show(new Rounds(seed, tables(k), 24, k & 1).all), handed.length);
