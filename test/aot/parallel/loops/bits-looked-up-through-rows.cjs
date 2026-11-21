// Bits are looked up in rows under keys that come out of other rows: rows of int32s, of doubles, of both, with holes, rows that change, and a list that the loop fills beside them.
const held = JSON.parse("{}"), name = text => text + process.argv.length % 1;
held[name("follow")] = function follow(rows, keys, count, out) { let word = 0x1234567; for (let k = 0; k < count; k++) { const key = keys[k & 7]; word ^= rows[key & 3][word >>> 28] ^ k; out[k] = word & rows[(key + 1) & 3][word & 15]; word = (word << 5) | (word >>> 27); } return word; };
held[name("chain")] = function chain(rows, next, count) { let at = 0, bits = 0; for (let k = 0; k < count; k++) { at = next[at] & 15; bits = (bits << 1 | bits >>> 31) ^ (rows[k & 1][at] | 0); } return bits; };
held[name("both")] = function both(first, second, keys, count) { let low = 1, high = 2; for (let k = 0; k < count; k++) { const key = keys[k % keys.length]; low = first[(low ^ key) & 15] ^ high; high = second[key & 15] & ~low; } return low + ":" + high; };
const ints = seed => Array.from({ length: 16 }, (_, k) => Math.imul(k * 7 + seed, 0x9e3779b1)), small = seed => Array.from({ length: 16 }, (_, k) => (k * 5 + seed) & 255), doubles = seed => ints(seed).map(value => value + 0.5), wide = seed => ints(seed).map(value => value >>> 0);
const holes = seed => { const row = ints(seed); delete row[3]; delete row[11]; return row; }, mixed = seed => ints(seed).map((value, k) => k % 5 ? value : k % 2 ? String(value) : value / 3);
const makers = {
  ints: () => [ints(1), ints(2), ints(3), ints(4)], small: () => [small(1), small(2), small(3), small(4)], doubles: () => [doubles(1), doubles(2), doubles(3), doubles(4)], both: () => [ints(1), doubles(2), small(3), wide(4)], holes: () => [ints(1), holes(2), small(3), holes(4)], mixed: () => [mixed(1), ints(2), mixed(3), ints(4)],
  views: () => [Int32Array.from(ints(1)), Uint32Array.from(ints(2)), Uint8Array.from(small(3)), Float64Array.from(doubles(4))], short: () => [ints(1).slice(0, 9), ints(2), [], ints(4)], same: () => { const row = ints(5); return [row, row, row, row]; }, missing: () => [ints(1), ints(2), ints(3)], alike: () => [ints(1), Object.assign({}, ints(2)), ints(3), "0123456789abcdef"],
  converts: () => [ints(1), Object.assign(ints(2), { 6: { valueOf: () => 77 } }), ints(3), ints(4)], frozen: () => [ints(1), ints(2), ints(3), ints(4)].map(row => Object.freeze(row)),
};
const outs = { list: () => [], view: () => new Int32Array(24), rowItself: rows => rows[1], table: () => ({}), doubles: () => [0.5, 1.5] };
const told = out => { let sum = 0; for (let k = 0; k < 24; k++) { const value = out[k]; sum = (sum * 33 + (typeof value === "number" ? value : typeof value === "undefined" ? 7 : String(value).length)) | 0; } return sum + "/" + out.length; };
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
const keys = [3, 1, 4, 1, 5, 9, 2, 6], lines = [];
for (let round = 0; round < 3; round++) for (const kind of Object.keys(makers)) {
  for (const where of Object.keys(outs)) { const rows = makers[kind](), out = outs[where](rows); lines.push([round, kind, where, attempt(() => held[name("follow")](rows, keys, 20 + round, out)), told(out)].join(" ")); }
  const rows = makers[kind]();
  lines.push([attempt(() => held[name("chain")](rows, small(round), 17)), attempt(() => held[name("both")](rows[0], rows[1], keys, 19)), attempt(() => held[name("both")](rows[2], rows[3], rows[0], 19))].join(" "));
  rows[0] = rows[1]; if (Array.isArray(rows[2]) && !Object.isFrozen(rows[2])) rows[2].push(2 ** 40);
  lines.push([attempt(() => held[name("chain")](rows, rows[2], 23)), attempt(() => held[name("follow")](rows, rows[1], 9, []))].join(" "));
}
console.log(lines.join("\n"));
