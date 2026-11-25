// Elements that bitwise operators take are taken for something else too: added, returned, compared, stored, handed on or given to a call.
const tables = {
  holes: [1, , 3.5, 4, , 6, 7.25, 8, 9, 10, , 12, 13, 14, 15, 16],
  ints: [1, -2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  intHoles: [1, , 3, 4, , 6, 7, 8, 9, 10, , 12, 13, 14, 15, 16],
  doubles: [0.5, -0, 4294967295, 2147483648, -2147483649, 1e300, 9007199254740993, NaN, Infinity, -1.5, 3, 4, 5, 6, 7, 8],
  short: [1, 2.5],
  anything: [1, "7", null, undefined, true, {}, [3], 8, false, 10, 11, 12, 13, 14, 15, 16],
};
let given = "nothing";
function give(x) { given = typeof x + String(x); }
function mix(s, i) { s = s << 1 ^ s >>> 31 ^ i * 5; s ^= s >>> 7; return (s + (i & 3) ^ s << 3) | 0; }
function summed(a, n) { let s = 1, t = 0; for (let i = 0; i < n; i++) { t = t + a[2]; s ^= a[2]; s = (s << 1 ^ s >>> 31 ^ i * 5) + (i & 3) ^ s >>> 7 ^ s << 2; s = s ^ i << 4 ^ s >>> 9; } return [s, t]; }
function scaled(a, n) { let s = 1, t = 0; for (let i = 0; i < n; i++) { const x = a[i & 15]; s ^= x; t += x * .5; s = (s << 1 ^ s >>> 31 ^ i * 5) + (i & 3) ^ s >>> 7 ^ s << 2; s = s ^ i << 4 ^ s >>> 9; } return [s, t]; }
function returned(a, n) { let s = 1, w; for (let i = 0; i < n; i++) { s ^= a[i & 15]; w = a[i & 15]; s = (s << 1 ^ s >>> 31 ^ i * 5) + (i & 3) ^ s >>> 7 ^ s << 2; s = s ^ i << 4 ^ s >>> 9; } return [s, w]; }
function returnedFirst(a, n) { let s = 1, w; for (let i = 0; i < n; i++) { w = a[i & 15]; s ^= a[i & 15]; s = (s << 1 ^ s >>> 31 ^ i * 5) + (i & 3) ^ s >>> 7 ^ s << 2; s = s ^ i << 4 ^ s >>> 9; } return [s, w]; }
function compared(a, n) { let s = 1, t = 0; for (let i = 0; i < n; i++) { const x = a[i & 15]; s ^= x; if (x === undefined) t++; s = (s << 1 ^ s >>> 31 ^ i * 5) + (i & 3) ^ s >>> 7 ^ s << 2; s = s ^ i << 4 ^ s >>> 9; } return [s, t]; }
function defaulted(a, n) { let s = 1; for (let i = 0; i < n; i++) { const x = a[i & 15]; s ^= x ?? 5; s = (s << 1 ^ s >>> 31 ^ i * 5) + (i & 3) ^ s >>> 7 ^ s << 2; s = s ^ i << 4 ^ s >>> 9; } return [s]; }
function chosen(a, n) { let s = 1, w = 3; for (let i = 0; i < n; i++) { s ^= (i & 1 ? a[i & 15] : w) | 0; w = a[3]; s = (s << 1 ^ s >>> 31 ^ i * 5) + (i & 3) ^ s >>> 7 ^ s << 2; s = s ^ i << 4 ^ s >>> 9; } return [s, w]; }
function handed(a, n) { let s = 1; for (let i = 0; i < n; i++) { const x = a[i & 15]; s ^= x; if (i === 7) give(x); s = (s << 1 ^ s >>> 31 ^ i * 5) + (i & 3) ^ s >>> 7 ^ s << 2; s = s ^ i << 4 ^ s >>> 9; } return [s, given]; }
function stored(a, n) { let s = 1; const b = [0, 0, 0, 0]; for (let i = 0; i < n; i++) { const x = a[i & 15]; s ^= x; b[i & 3] = x; s = (s << 1 ^ s >>> 31 ^ i * 5) + (i & 3) ^ s >>> 7 ^ s << 2; s = s ^ i << 4 ^ s >>> 9; } return [s, b]; }
for (const name in tables) {
  for (const f of [summed, scaled, returned, returnedFirst, compared, defaulted, chosen, handed, stored]) {
    let answer;
    try { answer = f(tables[name].slice(), 40).map(String).join(" "); } catch (error) { answer = error.name; }
    console.log(name, f.name, answer);
  }
}
console.log(mix(3, 5));
