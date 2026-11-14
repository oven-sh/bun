// Strings of digits, words and texts of other kinds beside numbers: bitwise operators and loose equality.
const K = 2000;
const texts = ["0", "7", "42", "007", "12345678", "999999999999999", "1234567890123456", "", " 5", "5 ", "-3", "1.5", "0x10", "1e3", "Infinity", "-Infinity", "Inf", "I", "e5", "x1", "abc", "é", "NaN", "length", "true", "２", "9".repeat(30), "4294967296", "2147483648", String.fromCharCode(0x31, 0x100)];
const numbers = [0, 7, 42, -3, 1.5, NaN, Infinity, 16, 1000, 4294967296, 2147483648, 12345678, 999999999999999, -0, 2 ** 31 - 1, -(2 ** 31)];
const list = JSON.parse(JSON.stringify(texts)), nums = numbers.slice();
const key = i => String(list[i % list.length]);
let t = 0, e = 0;
const rows = [];
for (let i = 0; i < list.length; i++) { const s = list[i]; rows.push([s | 0, s | 5, 5 | s, s ^ 3, s & 6, s << 3, 1 << s, s >> 1, -9 >> s, s >>> 1, ~s, +s].join()); for (const n of nums) { t = t * 3 + (s == n) + 2 * (n == s) + 4 * (s != n) | 0; t = t + ((s | n) ^ (n & s) ^ (s << n) ^ (n >> s)) | 0; } }
console.log(t); for (const row of rows) console.log(row);
const proxy = new Proxy([1, 2, 3], { get(target, property) { if (typeof property == "string" && (property | 0) == property) return target[property] * 2; return target[property]; } });
for (let k = 0; k < K; k++) { for (const v of proxy) e += v; const s = key(k); e = e + (s | 0) + (s == 7) | 0; }
console.log(e);
for (const other of [null, undefined, true, 10n, Symbol.iterator, { valueOf() { return "7"; } }, [7]]) for (const s of ["7", "1", "10"]) { let r; try { r = [s | other, other ^ s]; } catch (x) { r = x.constructor.name; } let q; try { q = [s == other, other == s]; } catch (x) { q = x.constructor.name; } console.log(String(r), String(q)); }
let rope = ""; for (let k = 0; k < 4; k++) rope += k; console.log(rope | 0, rope == 123, "1" + rope | 0, 10123 == "1" + rope);
