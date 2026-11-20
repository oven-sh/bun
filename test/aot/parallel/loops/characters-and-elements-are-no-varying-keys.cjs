// STATISTIC: VaryingKeyLookups <= 0
// Under: --aot-harden=proof-checks: what the loops read is as written
// Under: --aot-testing=FailSpeculations: the iterations restart
// Keyed reads of holders of which nothing is known, under the characters of a text (a decoder) and under the elements of a list: a lookup in each iteration costs more than the read as written.
"use strict";
const host = JSON.parse('{"a":1}');
const LETTERS = "bcdfghjklmnpqrstvwxz23456789aeio";
function placesOf(base) { const map = JSON.parse("{}"); for (let z = 0; z < LETTERS.length; z++) map[LETTERS.charAt(z)] = z + base; return map; }
function stirred(sum) {
  return ((sum << 3) ^ (sum >>> 11)) & 0xffffff;
}
host.decode = function (text, places) {
  const found = [];
  let sum = 7;
  for (let at = 0; at < text.length; ++at) {
    const letter = text.charAt(at);
    const place = places[letter];
    if (place === undefined) return "no place for " + letter;
    if (at < 60 && (at & 1) === 0) found.push(place);
    sum = stirred(sum) + place * 5;
  }
  return found.length + ":" + sum;
};
host.hits = function (keys, table) {
  let n = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof key !== "string") continue;
    const v = table[key];
    if (v !== undefined) n += v;
  }
  return n;
};
host.sum = function (data) { let n = 0; for (const key of Object.keys(data)) n += data[key]; return n; };
host.texts = function (text, table) { let out = ""; for (let i = 0; i < text.length; i++) out += table[text[i]] ?? "-"; return out; };
const lines = [], line = text => lines.push(text);
const map = host.map = placesOf(0), other = placesOf(100);
for (const text of ["bcdfghjk", "lmnpqrstvwxz23456789aeio".repeat(3), "bbbu", ""]) line(text.length + " " + host.decode(text, map) + " " + host.decode(text, other) + " " + host.texts(text, map));
const data = JSON.parse('{"one":1,"two":2,"three":3,"four":4}');
line([host.hits(Object.keys(data), data), host.hits(["one", "none", 3, "four"], data), host.hits([], data), host.sum(data), host.sum({}), host.sum(map)].join());
let reads = 0;
const trapped = new Proxy(data, { get: (t, k) => { reads++; return t[k]; } });
line([host.hits(["one", "two", "x"], trapped), host.sum(trapped), host.texts("ab", trapped), reads].join());
const withGetter = Object.defineProperty(JSON.parse('{"b":2}'), "a", { enumerable: true, get() { reads++; return 40; } });
line([host.hits(["a", "b", "c"], withGetter), host.sum(withGetter), host.texts("abc", withGetter), reads].join());
for (const holder of [null, undefined]) try { line(host.texts("a", holder)); } catch (error) { line(error.constructor.name); }
line(host.texts("01length", "xyz") + " " + host.texts("012", [5, 6, 7]));
let total = 0;
const long = "bcdfghjklmnpqrstvwxz23456789aeio".repeat(4);
for (let i = 0; i < 400; i++) total += host.decode(long, i & 1 ? other : map).length + host.hits(["one", "two", "three"], data) + host.sum(data);
line("total " + total);
console.log(lines.join("\n"));
