const bytes = new Uint8Array(16); for (let i = 0; i < 16; i++) bytes[i] = i * 37 + 5;
function fnv(h: number, n: number): number { for (let i = 0; i < n; i++) h = Math.imul(h ^ bytes[i & 15]!, 16777619) >>> 0; return h; }
function times(h: number, n: number): number { for (let i = 0; i < n; i++) h = (h * 31 + bytes[i & 15]!) >>> 0; return h; }
function shifts(h: number, n: number): number { for (let i = 0; i < n; i++) { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; } return h; }
function halves(h: number, n: number): string { let s = ""; for (let i = 0; i < n; i++) { s += (h / 2) + "," + (h > 2147483647) + "," + (h % 7) + ";"; h = (h + 2654435769) >>> 0; } return s + h; }
function either(h: number, n: number): number { for (let i = 0; i < n; i++) h = i & 1 ? (h + 1) | 0 : (h * 3) >>> 0; return h; }
function keys(h: number, n: number, list: number[]): string { let s = ""; for (let i = 0; i < n; i++) { s += list[h] + ","; h = (h + 4294967295) >>> 0; } return s + h; }
function two(a: number, b: number, n: number): string { for (let i = 0; i < n; i++) { const t = a; a = (b ^ (a >>> 3)) >>> 0; b = (t + b) >>> 0; } return a + ":" + b; }
function loose(h: unknown, n: number): unknown { for (let i = 0; i < n; i++) h = ((h as number) ^ 5) >>> 0; return h; }
const seeds = [2166136261, 0, 1, -1, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e300, 9007199254740991];
for (const s of seeds) for (const n of [0, 1, 2, 5])
  console.log(s, n, fnv(s, n), Object.is(fnv(s, n), -0), times(s, n), shifts(s, n), halves(s, n), either(s, n), keys(s, n, [10, 11, 12]), two(s, 7, n), two(7, s, n));
console.log(loose("12", 2), loose(null, 1), loose(undefined, 1), loose(undefined, 0), loose(true, 3), loose({ valueOf() { return 9; } }, 1), typeof loose("x", 0));
