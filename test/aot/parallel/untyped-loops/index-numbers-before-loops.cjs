// STATISTIC: IndexNumberGuardsHoisted >= 1
// rows[row * width + column]: what the loop does not change of an index, int32s or not.
"use strict";
exports.N1 = function (data) { const size = data.size; let points = 0; let sameCol = 0; let sameRow = 0; let lastCol = null; let lastRow = null;
  for (let row = 0; row < size; row++) { sameCol = sameRow = 0; lastCol = lastRow = null;
    for (let col = 0; col < size; col++) { let module = data.get(row, col); if (module === lastCol) { sameCol++; } else { if (sameCol >= 2) points += 3 + (sameCol - 2); lastCol = module; sameCol = 1; } module = data.get(col, row); if (module === lastRow) { sameRow++; } else { if (sameRow >= 2) points += 3 + (sameRow - 2); lastRow = module; sameRow = 1; } }
    if (sameCol >= 2) points += 3; if (sameRow >= 2) points += 3; }
  return points; };
exports.N2 = function (data) { const size = data.size; let points = 0; for (let row = 0; row < size - 1; row++) { for (let col = 0; col < size - 1; col++) { const last = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1); if (last === 4 || last === 0) points++; } } return points; };
exports.N3 = function (data) { const size = data.size; let points = 0; let bitsCol = 0; let bitsRow = 0; for (let row = 0; row < size; row++) { bitsCol = bitsRow = 0; for (let col = 0; col < size; col++) { bitsCol = ((bitsCol << 1) & 0x7FF) | data.get(row, col); if (col >= 2 && (bitsCol === 5 || bitsCol === 7)) points++; bitsRow = ((bitsRow << 1) & 0x7FF) | data.get(col, row); if (col >= 2 && (bitsRow === 5 || bitsRow === 7)) points++; } } return points; };
exports.mask = function (pattern, data) { const size = data.size; for (let col = 0; col < size; col++) { for (let row = 0; row < size; row++) { if (data.isReserved(row, col)) continue; data.xor(row, col, (row + col + pattern) % 2 === 0); } } };
function Matrix(size, data) { this.size = size; this.data = data; this.reserved = new Uint8Array(64); }
Matrix.prototype.set = function (row, col, value, reserved) { const index = row * this.size + col; this.data[index] = value; if (reserved) this.reserved[index] = true; };
Matrix.prototype.get = function (row, col) { return this.data[row * this.size + col]; };
Matrix.prototype.xor = function (row, col, value) { this.data[row * this.size + col] ^= value; };
Matrix.prototype.isReserved = function (row, col) { return this.reserved[row * this.size + col]; };
const kinds = [() => new Uint8Array(64).map((_, i) => i % 2), () => Array.from({ length: 64 }, (_, i) => i % 3), () => new Float64Array(40).fill(0.5), () => Array.from("0110100110010110"), () => new Uint8Array(0), () => [1, , 0.5, "1", null]];
const sizes = [7, 0, 1, -1, -0, 2.5, 4294967296, 2147483647, -2147483648, 1073741824, NaN, "5", "x", undefined, null, true, { valueOf() { return 5; } }, 5n, Symbol.iterator];
const own = a => typeof a === "string" ? a : a.length + ":" + Array.from(a, String).join("");
const tries = { N1: exports.N1, N2: exports.N2, N3: exports.N3, mask: m => exports.mask(1, m) };
for (let k = 0; k < 30; k++) { const m = new Matrix(sizes[0], kinds[0]()); for (const name of Object.keys(tries)) tries[name](m); }
for (const size of sizes) for (let k = 0; k < kinds.length; k++) for (const name of Object.keys(tries)) {
  const m = new Matrix(size, kinds[k]()); let r;
  if (typeof size === "number" && size > 100) m.size = size > 2 ** 31 ? size / 2 ** 30 : 9; else m.size = size;
  if (k === 5) Object.defineProperty(m, "size", { get() { return 6; }, configurable: true });
  try { r = tries[name](m); } catch (e) { r = e.constructor.name; } console.log(name, String(size), k, r, own(m.data));
}
for (const step of [0.5, 2 ** 30, -3, "1"]) { const m = new Matrix(5, kinds[0]()); let reads = 0; Object.defineProperty(m, "size", { get() { return reads++ === 0 ? 5 : reads > 12 ? step : 5; }, configurable: true }); let r; try { r = exports.N2(m); } catch (e) { r = e.constructor.name; } console.log(String(step), r, reads); }
