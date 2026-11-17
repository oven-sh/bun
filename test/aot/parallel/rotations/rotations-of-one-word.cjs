// Exclusive ors of rotations of one word.
const words = [0, 1, -1, 5, -2147483648, 2147483647, 0x12345678, -559038737, 0x80000001 | 0];
const fractions = [2.5, -7.9, 4294967295, 4294967296, -2147483649, 1e20, NaN, -0, "12", undefined, null, true];
function two(x) { return (x >>> 2 | x << 30) ^ (x >>> 13 | x << 19); }
function three(x) { return x >>> 6 ^ x >>> 11 ^ x >>> 25 ^ x << 26 ^ x << 21 ^ x << 7; }
function four(x) { return (x << 1 | x >>> 31) ^ (x << 5 | x >>> 27) ^ (x << 9 | x >>> 23) ^ (x << 30 | x >>> 2); }
function five(x) { return (x << 1 | x >>> 31) ^ (x << 5 | x >>> 27) ^ (x << 9 | x >>> 23) ^ (x << 30 | x >>> 2) ^ (x << 16 | x >>> 16); }
function same(x) { return (x << 3 | x >>> 29) ^ (x >>> 29 | x << 3) ^ (x << 4 | x >>> 28); }
function withShift(x) { return (x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ x >>> 3; }
function withOther(x, y) { return (x >>> 7 | x << 25) ^ y ^ (x >>> 18 | x << 14) ^ (y >>> 1 | y << 31); }
function withSelf(x) { return x ^ (x << 9 | x >>> 23) ^ (x << 17 | x >>> 15); }
function ofSelf(x) { const y = x ^ (x >>> 3 | x << 29); return y ^ (y >>> 7 | y << 25) ^ (x >>> 10 | x << 22); }
function nested(x) { const y = (x >>> 5 | x << 27) ^ x; return (y >>> 6 | y << 26) ^ (x >>> 25 | x << 7) ^ (x >>> 6 | x << 26); }
function kept(x) { const a = x >>> 2 | x << 30, b = x >>> 13 | x << 19; return (a ^ b) + a - b | 0; }
function mixed(x, y) { return (x >>> 2 | x << 30) ^ (y >>> 13 | y << 19) ^ (x >>> 22 | x << 10) ^ (y >>> 2 | y << 30); }
const functions = [two, three, four, five, same, withShift, withOther, withSelf, ofSelf, nested, kept, mixed];
for (const f of functions) {
  const answers = [];
  for (const x of words) {
    for (const y of words)
      answers.push(f(x, y));
  }
  for (const x of fractions)
    answers.push(f(x, 3), f(9, x));
  console.log(f.name, answers.join());
}
function rounds(state, words) {
  let a = state[0] | 0, e = state[1] | 0;
  for (let i = 0; i < 64; i++) {
    const t = words[i & 15] + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + (a & e ^ ~a & i) | 0;
    e = a + t | 0;
    a = t + ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) | 0;
    words[i & 15] = words[i & 15] ^ (t >>> 17 | t << 15) ^ (t >>> 19 | t << 13) ^ t >>> 10;
  }
  return [a, e];
}
console.log(rounds([1779033703, -1150833019], Array.from({ length: 16 }, (_, i) => Math.imul(i + 1, 0x9e3779b9))).join());
console.log(rounds([1.5, "7"], Array.from({ length: 16 }, (_, i) => i * 2654435769)).join());
console.log(rounds(new Int32Array([7, -9]), new Int32Array(16).fill(0x55555555)).join());
