// Evaluated text is interpreted in an executable: bit operations of int32s, of doubles inside and outside the range of int32 and int64, of NaN and infinities, and of what is no number.
const values = [0, -0, 1, -1, 2, 7, 31, 32, 33, -31, 255, 65535, 2147483647, -2147483648, 2147483648, -2147483649, 4294967295, 4294967296, 4294967297, -4294967296, 1e10, -1e10, 9007199254740991, -9007199254740991, 9007199254740993, 4611686018427387904, 4611686018427388928, -4611686018427387904, -4611686018427388928, 9223372036854775807, 9223372036854774784, -9223372036854775808, 1.8446744073709552e19, 1e21, -1e21, 1e300, 5e-324, 0.5, -0.5, 1.5, -1.5, 2147483647.5, -2147483648.5, 4294967295.9, NaN, Infinity, -Infinity, undefined, null, true, false, "", "12", "x", "0x10", "-1.5", "1e10", { valueOf: () => 2.5 }, [], [3], 5n, -3n, Symbol.iterator, function () {}];
const show = value => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? `${value}n` : String(value));
const text = `(function (values, show) {
  const operations = [(a, b) => a | b, (a, b) => a & b, (a, b) => a ^ b, (a, b) => a << b, (a, b) => a >> b, (a, b) => a >>> b, (a, b) => (a + b) | 0, (a, b) => (a * b) >>> 0, (a, b) => (a / b) | 0, (a, b) => ((a * 1000003) ^ b) >>> 0];
  const alone = [a => a | 0, a => a >>> 0, a => ~a, a => a & 255, a => a ^ -1, a => a << 1, a => a >> 31, a => a >>> 31, a => 1 << a, a => 1.5 | a, a => 4294967295 & a, a => 1e10 ^ a, a => -1 >>> a, a => (a >>> 0) + 1, a => (a >>> 0) / 2, a => -(a >>> 0)];
  const lines = [];
  let hash = 0;
  const attempt = f => { let s; try { s = show(f()); } catch (error) { s = error.name; } for (let k = 0; k < s.length; k++) hash = (Math.imul(hash, 31) + s.charCodeAt(k)) | 0; return s; };
  for (let turn = 0; turn < 2; turn++) {
    for (const a of values) lines.push(alone.map(f => attempt(() => f(a))).join(" "));
    for (const f of operations) { for (const a of values) for (const b of values) attempt(() => f(a, b)); lines.push(hash); }
  }
  return lines.join("\\n");
})`;
console.log((0, eval)(text)(values, show));
const functions = `(function (values, show) {
  const alone = [a => Math.floor(a), a => Math.clz32(a), a => Math.imul(a, 3), a => Math.max(a, 1), a => Math.min(a, 1), a => Math.max(a), a => Math.min(), a => Math.floor(), a => a / 3, a => 12 / a, a => -7 / a, a => a / 0, a => a / -0, a => a / -1];
  const pairs = [(a, b) => Math.max(a, b), (a, b) => Math.min(a, b), (a, b) => Math.imul(a, b), (a, b) => a / b, (a, b) => Math.floor(a / b), (a, b) => Math.max(a, b, 5), (a, b) => Math.floor(a, b)];
  const lines = [];
  let hash = 0;
  const attempt = f => { let s; try { s = show(f()); } catch (error) { s = error.name; } for (let k = 0; k < s.length; k++) hash = (Math.imul(hash, 31) + s.charCodeAt(k)) | 0; return s; };
  for (const a of values) lines.push(alone.map(f => attempt(() => f(a))).join(" "));
  for (const f of pairs) { for (const a of values) for (const b of values) attempt(() => f(a, b)); lines.push(hash); }
  return lines.join("\\n");
})`;
console.log((0, eval)(functions)(values, show));
console.log([7, -7.5, -0.5, -0, 2147483647.9, -2147483648.5, NaN, Infinity, "3.7", null, undefined].map(value => [Math.floor, Math.clz32].map(f => show(f(value))).join()).join(" "), [1, 2.5, -3].map((value, index) => show(Math.max(value, index)) + show(Math.min(index, value)) + show(Math.imul(index, value))).join(" "));
