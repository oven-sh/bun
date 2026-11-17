// Copies in loops whose returns are integers, null, undefined and values that are read as integers or null.
function Entry(key, value) { this.key = key; this.value = value; this.next = null; }
function find(table, key) { var e = table[key & 7]; while (e) { if (e.key === key) return e; e = e.next; } return null; }
function get(table, key) { var e = find(table, key); if (e) return e.value; return null; }
function getOrNothing(table, key) { var e = find(table, key); if (e) return e.value; return undefined; }
function getOrEither(table, key) { if (key === 3) return undefined; var e = find(table, key); if (e) return e.value; return null; }
function getOrZero(table, key) { var e = find(table, key); if (e === null) return null; return e.value === null ? null : e.value - 1; }
function getOrHalf(table, key) { var e = find(table, key); if (e) return e.value; return key === 9 ? 0.5 : null; }
function getOrText(table, key) { var e = find(table, key); if (e) return e.value; return key === 9 ? "none" : null; }
function getOrNegativeZero(table, key) { var e = find(table, key); if (e) return e.value; return key === 9 ? -0 : null; }
function getOrTrue(table, key) { var e = find(table, key); if (e) return e.value; return key === 9 ? true : null; }
function getOrLarge(table, key) { var e = find(table, key); if (e) return e.value; return key === 9 ? 2147483648 : null; }
function getOrNothingAtAll(table, key) { var e = find(table, key); if (e) return e.value; }
function told(v) { return v === null ? "null" : v === undefined ? "undefined" : Object.is(v, -0) ? "-0" : typeof v + " " + v; }
var kept = 0, lines = [];
function make(values) { var table = []; for (var i = 0; i < 8; i++) table.push(null); for (var i = 0; i < values.length; i++) { var e = new Entry(i * 2, values[i]); e.next = table[e.key & 7]; table[e.key & 7] = e; } return table; }
function sums(table) { var sum = 0, nulls = 0, nothings = 0; for (var i = 0; i < 12; i++) { var v = get(table, i); if (v === null) nulls++; else if (v === undefined) nothings++; else sum += v; } return sum + " " + nulls + " " + nothings; }
function loose(table) { var nulls = 0; for (var i = 0; i < 12; i++) if (getOrNothing(table, i) == null) nulls++; return nulls; }
function types(table) { var s = ""; for (var i = 0; i < 12; i++) s += typeof get(table, i) + " " + typeof getOrNothing(table, i) + " " + typeof getOrEither(table, i) + ","; return s; }
function either(table) { var s = ""; for (var i = 0; i < 12; i++) { var v = getOrEither(table, i); s += told(v) + ";"; } return s; }
function less(table) { var s = ""; for (var i = 0; i < 12; i++) { var v = getOrZero(table, i); s += told(v) + " " + (v + 1) + " " + (v | 0) + " " + !v + ";"; } return s; }
function half(table) { var s = ""; for (var i = 0; i < 12; i++) s += told(getOrHalf(table, i)) + ";"; return s; }
function text(table) { var s = ""; for (var i = 0; i < 12; i++) s += told(getOrText(table, i)) + ";"; return s; }
function zero(table) { var s = ""; for (var i = 0; i < 12; i++) s += told(getOrNegativeZero(table, i)) + ";"; return s; }
function yes(table) { var s = ""; for (var i = 0; i < 12; i++) s += told(getOrTrue(table, i)) + ";"; return s; }
function large(table) { var s = ""; for (var i = 0; i < 12; i++) s += told(getOrLarge(table, i)) + ";"; return s; }
function nothing(table) { var s = ""; for (var i = 0; i < 12; i++) s += told(getOrNothingAtAll(table, i)) + ";"; return s; }
function lists(table) { var a = [], o = { v: 1 }; for (var i = 0; i < 12; i++) { a.push(get(table, i)); o.v = get(table, i); kept = get(table, i + 1); a.push(o.v === kept); } return a.map(told).join() + told(o.v) + told(kept); }
function last(table) { var v = 5, same = 0; for (var i = 0; i < 12; i++) { var w = get(table, i); if (w === v) same++; v = w; } return same + told(v); }
var tables = [make([1, 2, 3, 4]), make([1, null, 3, null]), make([null, null]), make([0, -1, 2147483647, -2147483648, 5]), make([1, undefined, null, 7])];
for (var table of tables)
    for (var cell of [sums, loose, types, either, less, half, text, zero, yes, large, nothing, lists, last]) lines.push(cell.name + " " + cell(table));
console.log(lines.join("\n"));
