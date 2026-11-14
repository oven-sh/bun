// lsw = (x & 0xffff) + (y & 0xffff); msw = (x >> 16) + (y >> 16) + (lsw >> 16); (msw << 16) | (lsw & 0xffff) is the sum of two words.
// STATISTIC: HalvesAddedAsWords >= 5
function safeAdd(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); const msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
function turned(x, y) { const low = (0xffff & y) + (0xffff & x); const high = (low >>> 16) + ((y >>> 16) + (x >>> 16)); return (0xffff & low) | (high << 16); }
function constant(x) { const lsw = (x & 0xffff) + (-680876936 & 0xffff); const msw = (x >> 16) + (-680876936 >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
function doubled(x) { const lsw = (x & 0xffff) + (x & 0xffff); const msw = (x >> 16) + (x >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
function withoutCarry(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); const msw = (x >> 16) + (y >> 16); return (msw << 16) | (lsw & 0xffff); }
function otherCarry(x, y, z) { const lsw = (x & 0xffff) + (y & 0xffff); const other = (x & 0xffff) + (z & 0xffff); const msw = (x >> 16) + (y >> 16) + (other >> 16); return (msw << 16) | (lsw & 0xffff); }
function crossed(x, y, z) { const lsw = (x & 0xffff) + (y & 0xffff); const msw = (x >> 16) + (z >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
function otherMask(x, y) { const lsw = (x & 0x7fff) + (y & 0xffff); const msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
function otherShift(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); const msw = (x >> 15) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
function exclusive(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); const msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) ^ (lsw & 0xffff); }
function four(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); const msw = (x >> 16) + (y >> 16) + (lsw >> 16) + 1; return (msw << 16) | (lsw & 0xffff); }
function large(x) { const lsw = (x & 0xffff) + 70000; const msw = (x >> 16) + 3 + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
function negativeHigh(x) { const lsw = (x & 0xffff) + 12; const msw = (x >> 16) + -32768 + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
const words = [0, 1, -1, 0x7fffffff, -0x80000000, 0xffff, 0x10000, -0x10000, 0x12345678, -0x12345678, 0x8000, -0x8000, 65535.9, 1e10, -1e10, NaN, undefined, null, true, "70000", 4294967296.5, 2 ** 53, { valueOf() { return 0x1ffff; } }, [7]];
for (const x of words) {
  const row = [constant(x), doubled(x), large(x), negativeHigh(x)];
  for (const y of words) row.push(safeAdd(x, y), turned(x, y), withoutCarry(x, y), otherCarry(x, y, 5), crossed(x, y, x), otherMask(x, y), otherShift(x, y), exclusive(x, y), four(x, y));
  let h = 0;
  for (const r of row) h = Math.imul(h, 31) + r | 0;
  console.log(h, row.slice(0, 16).join());
}
try { safeAdd(1n, 2n); } catch (e) { console.log(e.name); }
try { safeAdd(Symbol("s"), 2); } catch (e) { console.log(e.name); }
let a = 1732584193, b = -271733879, log = [];
for (let i = 0; i < 500; i++) { const t = safeAdd(safeAdd(a, b ^ i), safeAdd(i * 0x9e3779b1 | 0, -680876936)); a = turned(b, t); b = safeAdd((a << 7) | (a >>> 25), doubled(t)); }
console.log(a, b);
const counted = { valueOf() { log.push("v"); return 3; } };
console.log(safeAdd(counted, 4), log.join(), turned(counted, counted), log.join());
