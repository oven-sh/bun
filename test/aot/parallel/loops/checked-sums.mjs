// Sums of integers that nothing bounds, in loops that call: below and past 2 ** 52 and 2 ** 53, where doubles round, up and down.
// STATISTIC: CheckedSumsCarried >= 4
const show = x => Object.is(x, -0) ? "-0" : String(x);
const words = ["a1", "bb2", "ccc", "4"], records = [{ a: 1 }, { a: 1, b: 2 }];
function flipped(x) { return x > 2e9 ? flipped(x - 1) : x ^ 5; }
function found(turns) { let n = 0; for (let k = 0; k < turns; k++) n += words[k & 3].search(/\d/); return n; }
function keys(turns) { let n = 3; for (let k = 0; k < turns; k++) n += Object.keys(records[k & 1]).length; return n; }
function up(turns, high) { let n = 4503599627370490; for (let k = 0; k < turns; k++) { n += flipped(high | 0) >>> 0; n += words[k & 3].search(/\d/); } return n; }
function down(turns, high) { let n = -4503599627370490; for (let k = 0; k < turns; k++) { n -= flipped(high | 0) >>> 0; n -= words[k & 3].search(/\d/); } return n; }
function back(turns, high) { let n = 4503599627370490; for (let k = 0; k < turns; k++) { if (k & 1) n -= flipped(high | 0); else n += flipped(7 - high | 0); n += words[k & 3].search(/b/); } return n; }
function both(turns, high) { let n = 4503599627370490, m = 0; for (let k = 0; k < turns; k++) { n += flipped(high | 0) >>> 0; m -= words[k & 3].search(/\d/) + 1; } return n + "," + m; }
function read(turns) { let n = 4503599627370490, text = ""; for (let k = 0; k < turns; k++) { n += words[k & 3].search(/\d/) + 1; if (k % 500 === 3) text += n + " "; } return text + n; }
function left(turns) { let n = 0, k = 0; while (k < turns) { n += flipped(k) + 2147480000; if (n > 1e12) break; n += Object.keys(records[k & 1]).length; k++; } return [n, k]; }
function thrown(turns) { let n = 0; try { for (let k = 0; k < turns; k++) { n += words[k & 7].search(/\d/); n += 2147483647; } } catch { return "threw " + n; } return n; }
for (const turns of [0, 1, 2, 3, 4, 5, 6, 7, 8, 40, 3000]) console.log(show(found(turns)), show(keys(turns)), up(turns, -1), up(turns, 5), up(turns, 4), down(turns, -1), down(turns, 4), back(turns, 2000000000), both(turns, 5), read(turns), left(turns).join(), thrown(turns));
for (const turns of [400000, 1048574, 1048575, 1048576, 1048577, 1300000]) console.log(up(turns, -1), up(turns, -2), down(turns, -1), down(turns, -4), back(turns, 2000000000), both(turns, -3), left(1e9).join());
