// Variables of numbers that bitwise operations are stored into: sums past int32 and 2 ** 53, fractions, -0 and NaN between the cuts, other stores, reads of every kind.
const show = x => (Object.is(x, -0) ? "-0" : String(x));
let seen = 0, hash = 0, mixed = 0.5, word = 1;
const listeners = [x => { seen += x; }, x => { seen ^= x; }, x => { seen = (seen * 3 + x) | 0; }, x => { seen -= x / 2; }, x => { seen >>>= 1; }, x => { seen = -seen; }];
function emit(x, mask) { for (let i = 0; i < listeners.length; i++) if (mask >> i & 1) listeners[i](x); }
const values = [0, 1, -1, 7, 2147483647, -2147483648, 4294967295, 2 ** 40, 2 ** 53, 0.5, -0.25, -0, NaN, Infinity, 1e300];
const out = [];
for (let mask = 0; mask < 64; mask++) { for (const v of values) emit(v, mask); out.push(show(seen), seen & 3, seen > 0, typeof seen); if (mask % 9 === 0) seen = values[mask % values.length]; }
for (let k = 0; k < 300000; k++) { emit(k & 255, 3); if ((seen & 1023) === 5) out.push(seen); }
out.push(seen);
for (let k = 0; k < 1000; k++) { hash = (hash * 31 + (k ^ 85)) | 0; hash += k / 7; }
out.push(hash);
function fold(x) { mixed = x ? mixed ^ x : mixed * 1.5; return mixed; }
for (let k = 0; k < 40; k++) out.push(show(fold(k % 4)));
function step() { word <<= 1; word += 0.5; return word; }
for (let k = 0; k < 70; k++) out.push(step());
word = undefined; word |= 3; out.push(word); word = "12"; word ^= 1; out.push(word); word = 5n; word ^= 1n; out.push(String(word));
console.log(out.join(" "));
