// A counter that grows by a step is a whole number that may leave the integers: it is kept in a double. A list of numbers read under it gives its numbers unboxed; a key that is no index (NaN, Infinity, 2 ** 32 - 1, a negative, a number past 2 ** 53) is a name and is looked for as one.
function Table(size, named) {
  this.size = size | 0;
  const table = new Array(this.size);
  for (let i = 0; i < table.length; i += 2) { table[i] = Math.cos(i) / 3; table[i + 1] = -Math.sin(i) / 3; }
  if (named) { table.NaN = 0.25; table.Infinity = 0.5; table["-4"] = 0.75; table["4294967295"] = 1.25; table["-Infinity"] = 1.5; table["89412376652763660"] = 1.75; }
  this.table = table;
}
Table.prototype.sum = function (width) { const table = this.table, step = 1 << width; let s = 0; for (let i = 0, k = 0; i < 20; i += 2, k += step) s += table[k] * 0.5 + table[k + 1] * table[2 * k]; return s; };
Table.prototype.grown = function (width) { const table = this.table; let s = 0, missing = 0; for (let i = 0, k = 1 << width; i < 14; i++, k = k * k - k) { const y = table[k] * 2; if (y === y) s += y; else missing++; } return missing + " " + s.toFixed(6); };
Table.prototype.below = function (width) { const table = this.table, step = 1 << width; let s = 0, missing = 0; for (let i = 0, k = -8; i < 8; i++, k += step) { const y = table[k] * 2; if (y === y) s += y; else missing++; } return missing + " " + s.toFixed(6); };
Table.prototype.shrunk = function (width) { const table = this.table; let s = 0, missing = 0; for (let i = 0, k = -(1 << width); i < 14; i++, k = -(k * k)) { const y = table[k] * 2; if (y === y) s += y; else missing++; } return missing + " " + s.toFixed(6); };
Table.prototype.high = function (width) { const table = this.table, step = 1 << width; let s = 0, missing = 0; for (let i = 0, k = 4294967291; i < 8; i++, k += step) { const y = table[k] * 2; if (y === y) s += y; else missing++; } return missing + " " + s.toFixed(6); };
Table.prototype.zero = function (width) { const table = this.table; let s = 0; for (let i = 0, k = -(width >> 9); i < 3; i++, k = k * -1) s += table[k] * 2; return s.toFixed(6); };
const plain = new Table(64, 0), named = new Table(64, 1), short = new Table(2, 1);
for (let turn = 0; turn < 3; turn++) for (let width = 0; width < 5; width++) {
  console.log(width, String(plain.sum(width)).slice(0, 12), plain.grown(width), plain.below(width), plain.shrunk(width), plain.high(width), plain.zero(width));
  console.log(width, String(named.sum(width)).slice(0, 12), named.grown(width), named.below(width), named.shrunk(width), named.high(width), named.zero(width));
  console.log(width, String(short.sum(width)).slice(0, 12), short.grown(width), short.below(width), short.shrunk(width), short.high(width), short.zero(width));
}
