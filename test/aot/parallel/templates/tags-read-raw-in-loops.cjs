// Tags in loops read the raw strings of the object that they are handed: their number, each of them, the array itself.
"use strict";
function count(s, ...v) { return s.raw.length + v[0]; }
function first(s, ...v) { return s.raw[0] + "|" + s[0] + "|" + v.join(); }
function last(s, ...v) { return s.raw[s.raw.length - 1] + "/" + s[s.length - 1]; }
function beyond(s, ...v) { return [s.raw[9], s.raw[-1], s.raw["0"], s.raw.missing].join(); }
function same(s, ...v) { return s.raw === s.raw && s.raw !== s && Object.isFrozen(s) && Object.isFrozen(s.raw) && Array.isArray(s.raw); }
function all(s, ...v) { let t = ""; for (const r of s.raw) t += r + ";"; return t + s.raw.map(r => r.length).join(); }
function at(s, ...v) { return s.raw[v[0]] + "," + s[v[0]]; }
const keep = new Set();
function keeps(s, ...v) { keep.add(s); keep.add(s.raw); return keep.size; }
function writes(s, ...v) { try { s.raw[0] = "x"; } catch (e) { return e.name; } return s.raw[0]; }
function replaces(s, ...v) { try { s.raw = 1; } catch (e) { return e.name; } return s.raw; }
function described(s, ...v) { const d = Object.getOwnPropertyDescriptor(s, "raw"); return [d.writable, d.enumerable, d.configurable, d.value === s.raw].join(); }
function repeat(tag, turns) {
  let t = "";
  for (let k = 0; k < turns; k++) t += tag`a${k & 3}\n\u0041${k}\q` + " ";
  return t;
}
function direct(turns) {
  let n = 0, t = "";
  for (let k = 0; k < turns; k++) {
    n += count`x${k & 7}\n`;
    t += first`\t${k}` + last`${k}\x41` + beyond`z${k}` + same`q${1}` + at`0${k % 3}1${2}2`;
    try { t += all`\u{41}${k}b` + writes`w${k}` + replaces`r${k}` + described`d${k}`; } catch (e) { t += e.name; }
    t += keeps`${k}` + String.raw`\n${k}\\` + first`\unicode and \xerxes`;
  }
  return n + " " + t;
}
for (const turns of [0, 1, 2, 5]) {
  console.log(direct(turns));
  for (const tag of [count, first, last, beyond, same, all, at, keeps, writes, replaces, described]) console.log(tag.name, repeat(tag, turns));
}
