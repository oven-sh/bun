// Comparisons whose answer may be decided by what is known of the ranges of their operands, at the ends of those ranges: every answer is computed again from values the compiler cannot see.
const out: string[] = [];
const hidden = (value: number): number => JSON.parse(JSON.stringify(value));
const samples = [0, -0, 1, -1, 2, 7, 8, 255, 256, 65535, 65536, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 1.5, -1.5, NaN, Infinity, -Infinity, 9007199254740991, 9007199254740992];
function bits(...answers: boolean[]): string { return answers.map(answer => (answer ? "1" : "0")).join(""); }
function masks(v: number): string { const low = v & 7, byte = v & 255, word = v & 65535; return bits(low < 8, low <= 7, low > 7, low >= 8, low < 7, low > 6, low >= 0, low < 0, byte > 254, byte >= 255, byte < 256, word > 65534, word < 65536); }
function int32(v: number): string { const i = v | 0; return bits(i > 2147483646, i >= 2147483647, i < 2147483648, i <= 2147483647, i > 2147483647, i < -2147483647, i <= -2147483648, i >= -2147483648, i < -2147483648); }
function uint32(v: number): string { const u = v >>> 0; return bits(u >= 0, u < 0, u > 4294967294, u >= 4294967295, u < 4294967296, u > 4294967295, u > 2147483647, u <= 2147483647); }
function sums(v: number, w: number): string { const a = v & 7, b = w & 7, sum = a + b, difference = a - b, product = a * b; return bits(sum <= 14, sum > 14, sum > 13, sum >= 0, difference >= -7, difference <= 7, difference > 6, difference < -6, product >= 0, product <= 49, product > 48, sum > difference - 1, a < a + 1, a > a - 1); }
function wide(v: number, w: number): string { const a = v | 0, b = w | 0, sum = a + b, product = a * b, neg = -a; return bits(sum > 2147483647, sum < -2147483648, sum >= -4294967296, sum <= 4294967294, product > 2147483647, Object.is(product, -0), neg > 2147483647, neg <= 2147483648, neg === a); }
function remainders(v: number): string { const i = v | 0, r = i % 8, u = (v >>> 0) % 8, s = i >> 28, z = (v >>> 0) >>> 28, m = Math.abs(i), n = Math.min(i & 7, 3), x = Math.max(i & 7, 3); return bits(r < 8, r > -8, r >= 0, r === 0, u < 8, u >= 0, s >= -8, s < 8, z < 16, z > 15, m >= 0, m > 2147483647, n <= 3, n > 3, x >= 3, x < 3, Math.trunc(i / 2) <= 1073741824); }
function lengths(text: string, list: number[]): string { return bits(text.length >= 0, text.length < 0, list.length >= 0, list.length < 0, list.length <= 4294967295, list.length > 4294967294, text.length <= 2147483647, text.charCodeAt(0) < 65536, text.charCodeAt(0) >= 0, text.indexOf("a") >= -1, text.indexOf("a") < -1); }
function written(kind: "a" | "bc" | "def"): string { return bits(kind.length > 3, kind.length >= 3, kind.length < 1, kind.length <= 1, kind.length >= 1, kind.length < 4); }
function counter(limit: number): string { let seen = ""; for (let k = 0; k < (limit & 3); k++) { seen += bits(k < 3, k >= 3, k >= 0, k > 2) + ","; } let down = limit & 3; while (down > 0) { seen += bits(down > 3, down <= 3, down >= 1); down--; } return seen; }
function loopEnd(limit: number): string { let k = 0; for (; k < (limit & 7); k++); return bits(k >= 8, k <= 7, k < 0, k >= 0); }
function joined(flag: boolean, v: number): string { const value = flag ? v & 3 : (v & 3) + 10; return bits(value < 14, value >= 0, value > 3, value < 10, value > 12); }
function mixed(flag: boolean, v: number): string { const value: number = flag ? v & 3 : v; return bits(value < 4, value >= 0); }
for (const v of samples) {
  const seen = hidden(v === v && Number.isFinite(v) ? v : 0);
  const line = [masks(v), masks(seen), int32(v), int32(seen), uint32(v), uint32(seen), remainders(v), remainders(seen), counter(v), counter(seen), loopEnd(v), loopEnd(seen), joined(true, v), joined(false, v), mixed(true, v), mixed(false, v)];
  for (const w of [0, 1, -1, 7, 8, 2147483647, -2147483648, 1.5]) line.push(sums(v, w), wide(v, w));
  out.push(line.join(" "));
}
for (const text of ["", "a", "é", "😀", "x".repeat(70000)]) for (const list of [[], [1], new Array(5)]) out.push(lengths(text, list as number[]));
for (const kind of ["a", "bc", "def"] as const) out.push(written(kind));
console.log(out.join("\n"));
