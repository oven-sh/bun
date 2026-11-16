// STATISTIC: VaryingKeyLookups <= 0
// Under: --aot-harden=proof-checks: what the loops read is as written
// Under: --aot-testing=FailSpeculations: the iterations restart
// Keyed reads of holders of which nothing is known, under the characters of a text (bech32's decoder) and under the elements of a list: a lookup in each iteration costs more than the read as written.
"use strict";
const host = JSON.parse('{"a":1}');
const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function makeMap(base) { const map = JSON.parse("{}"); for (let z = 0; z < ALPHABET.length; z++) map[ALPHABET.charAt(z)] = z + base; return map; }
function polymodStep(pre) {
  const b = pre >> 25;
  return ((pre & 0x1ffffff) << 5) ^ (-((b >> 0) & 1) & 0x3b6a57b2) ^ (-((b >> 1) & 1) & 0x26508e6d) ^ (-((b >> 2) & 1) & 0x1ea119fa) ^ (-((b >> 3) & 1) & 0x3d4233dd) ^ (-((b >> 4) & 1) & 0x2a1462b3);
}
host.decode = function (text, map) {
  let chk = 1;
  const words = [];
  for (let i = 0; i < text.length; ++i) {
    const c = text.charAt(i);
    const v = map[c];
    if (v === undefined) return "Unknown character " + c;
    chk = polymodStep(chk) ^ v;
    if (i + 6 >= text.length) continue;
    words.push(v);
  }
  return chk + ":" + words.length;
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
const map = host.map = makeMap(0), other = makeMap(100);
for (const text of ["qpzry9x8", "gf2tvdw0s3jn54khce6mua7l".repeat(3), "qqqb", ""]) line(text.length + " " + host.decode(text, map) + " " + host.decode(text, other) + " " + host.texts(text, map));
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
const long = "qpzry9x8gf2tvdw0s3jn54khce6mua7l".repeat(4);
for (let i = 0; i < 400; i++) total += host.decode(long, i & 1 ? other : map).length + host.hits(["one", "two", "three"], data) + host.sum(data);
line("total " + total);
console.log(lines.join("\n"));
