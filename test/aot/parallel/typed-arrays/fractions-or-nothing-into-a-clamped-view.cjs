// A clamped view ROUNDS what it is given: 1.5 becomes 2, 2.5 becomes 2, 254.6 becomes 255, -3 becomes 0, 300 becomes 255. A number that may also be undefined or null goes into other views of whole numbers by `| 0`,
// which CUTS the fraction off: so such a value may not take that road into a clamped view. Booleans alone may go in line: 0 and 1 need neither rounding nor clamping.
"use strict";
const c8 = new Uint8ClampedArray(16), u8 = new Uint8Array(16);
function fractionOrUndefined(n, k) { for (let i = 0; i < n; i++) { c8[i] = i > k ? i + 0.5 : undefined; u8[i] = i > k ? i + 0.5 : undefined; } }
function fractionOrNull(n, k) { for (let i = 0; i < n; i++) { c8[i] = i > k ? 254.6 - i : null; u8[i] = i > k ? 254.6 - i : null; } }
function largeOrUndefined(n, k) { for (let i = 0; i < n; i++) { c8[i] = i > k ? 250.5 + i * 3 : undefined; u8[i] = i > k ? 250.5 + i * 3 : undefined; } }
function belowZeroOrNull(n, k) { for (let i = 0; i < n; i++) { c8[i] = i > k ? 1.5 - i : null; u8[i] = i > k ? 1.5 - i : null; } }
function booleans(n, k) { for (let i = 0; i < n; i++) { c8[i] = i > k; u8[i] = i <= k; } }
function one(i, flag) { const x = flag ? 1.5 : undefined; c8[i] = x; return c8[i]; }
for (const f of [fractionOrUndefined, fractionOrNull, largeOrUndefined, belowZeroOrNull, booleans]) for (const k of [-1, 3, 20]) { c8.fill(9); u8.fill(9); for (let round = 0; round < 3; round++) f(12, k); console.log(f.name, k, c8.join(), "|", u8.join()); }
console.log("one", one(0, true), one(1, false), one(2, true));
