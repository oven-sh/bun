// Quotients of integers that no constant gives away, behind `| 0`, `>>> 0`, `~~`, `>>`, `&`, Math.floor, ceil, trunc and round: divisors of zero, negative operands, -0, quotients past 2 ** 32, dividends near 2 ** 53, halves.
const zero = Date.now() & 0;
const out = [];
function show(v) { return Object.is(v, -0) ? "-0" : String(v); }
function anySign(a, b) { a = a | 0; b = b | 0; out.push(show((a / b) | 0), show((a / b) >>> 0), show(~~(a / b)), show((a / b) >> 1), show((a / b) & 255), show(Math.floor(a / b)), show(Math.ceil(a / b)), show(Math.trunc(a / b)), show(Math.round(a / b))); }
function neverNegative(a, b) { a = (a | 0) & 0x7fffffff; b = ((b | 0) & 0x7fffffff) + 1; out.push(show(Math.floor(a / b)), show(Math.ceil(a / b)), show(Math.trunc(a / b)), show(Math.round(a / b)), show((a / b) | 0)); }
function positiveDivisor(a, b) { a = a | 0; b = ((b | 0) & 0x7fffffff) + 1; out.push(show(Math.floor(a / b)), show(Math.floor((a * 4194303) / b)), show(((a * 4194303) / b) | 0), show(((a * 4194303) / b) >>> 0), show(Math.floor((a * 2097152 + 1) / (b * 3)))); }
function halves(a, b) { a = (a | 0) & 0x7fffffff; b = ((b | 0) & 0xffff) + 1; out.push(show(Math.round((a * 1048576) / b)), show(Math.round(a / (b * 2))), show(Math.round((a * 2 + 1) / 2)), show(Math.round((a * 2 + 1) / (b * 2)))); }
function all(a, b) { anySign(a, b); neverNegative(a, b); positiveDivisor(a, b); halves(a, b); }
const values = [0, 1, -1, 2, -2, 3, -3, 7, -7, 10, 100, 2147483647, -2147483648, 65536, -65535, 46341, 1000003];
for (const a of values) for (const b of values) all(zero + a, zero + b);
for (let i = -50; i < 50; i++) for (let j = -9; j < 10; j++) all(i, j);
let hash = 0;
for (const s of out) for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
console.log(out.length, hash);
for (let i = 0; i < out.length; i += 23 * 40) console.log(out.slice(i, i + 23 * 40).join(" "));
