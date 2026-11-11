// STATISTIC: Int32SpeculationsWithNumberFallback >= 5
function viaXor(h, k) { h ^= k; return (h << 3) | (h >>> 29); }
function viaAnd(h, k) { h &= k; return ((h << 3) | (h >>> 29)) ^ 5; }
function viaOr(h, k) { h |= k; return ((h << 3) | (h >>> 29)) ^ 9; }
function viaLeft(h, k) { h <<= k; return ((h << 1) | (h >>> 31)) ^ 3; }
function viaRight(h, k) { h >>= k; return ((h << 7) | (h >>> 25)) ^ 11; }
function viaZero(h, k) { h >>>= k; return ((h << 7) | (h >>> 25)) ^ 13; }
function viaNot(h, k) { h ^= ~k; return (h << 3) | (h >>> 29); }
const numbers = JSON.parse("[0, 1, -1, 7.5, -7.5, 31.9, 32, 33.5, 2147483647, 2147483648, -2147483649, 4294967296.5, 9007199254740992, 1e21, -1e21, 5e-324, 0, 0, 0, 0]");
numbers[16] = NaN;
numbers[17] = Infinity;
numbers[18] = -Infinity;
numbers[19] = -0;
function xors(m) { let h = 12345; for (let i = 0; i < 20; i++) h = viaXor(h, m); return h; }
function ands(m) { let h = 12345; for (let i = 0; i < 20; i++) h = viaAnd(h, m); return h; }
function ors(m) { let h = 12345; for (let i = 0; i < 20; i++) h = viaOr(h, m); return h; }
function lefts(m) { let h = 12345; for (let i = 0; i < 20; i++) h = viaLeft(h, m); return h; }
function rights(m) { let h = 12345; for (let i = 0; i < 20; i++) h = viaRight(h, m); return h; }
function zeros(m) { let h = 12345; for (let i = 0; i < 20; i++) h = viaZero(h, m); return h; }
function nots(m) { let h = 12345; for (let i = 0; i < 20; i++) h = viaNot(h, m); return h; }
const said = { xors: [], ands: [], ors: [], lefts: [], rights: [], zeros: [], nots: [] };
for (let n = 0; n < numbers.length; n++) {
  const m = numbers[n];
  said.xors.push(xors(m));
  said.ands.push(ands(m));
  said.ors.push(ors(m));
  said.lefts.push(lefts(m));
  said.rights.push(rights(m));
  said.zeros.push(zeros(m));
  said.nots.push(nots(m));
}
for (const name in said) console.log(name, said[name].join());
