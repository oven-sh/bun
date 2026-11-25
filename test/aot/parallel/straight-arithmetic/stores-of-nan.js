// Straight code stores doubles at constant indexes. NaN is no double of an array of doubles: there it is a hole.
const rows = Array.from([2.5, 9, 8.5, 1.5, 2.5, 3.5]);
rows[1] = NaN;
rows[3] = -Infinity; rows[4] = -0; rows[2] = 1.5; rows[0] = 8; rows[5] = 0.5;
console.log(rows.join(" "), 1 in rows, Object.is(rows[4], -0));
function fill(m, x) {
  m[0] = Math.floor(x); m[1] = x % 4; m[2] = Math.round(x) * 2; m[3] = Math.trunc(x); m[4] = x - x; m[5] = Math.sign(x);
  return m;
}
const kept = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
for (const x of [1.5, NaN, Infinity, -0, 7, "3", undefined, -2.5]) {
  fill(kept, x);
  console.log(kept.join(" "), Object.keys(kept).length, 0 in kept, 1 in kept, 5 in kept);
}
function convert(m, text) {
  m[0] = parseInt(text, 10); m[1] = Number(text) % 2; m[2] = text.charCodeAt(9); m[3] = Math.ceil(text / 2); m[4] = Math.min(text.length, 4); m[5] = +text;
  return m;
}
for (const text of ["12", "x", "3.5", ""]) {
  convert(kept, text);
  console.log(kept.join(" "), Object.keys(kept).length, 2 in kept, 3 in kept);
}
function product(a, b, r) {
  const a0 = a[0], a1 = a[1], b0 = b[0], b1 = b[1];
  r[0] = a0 * b0 + a1 * b1; r[1] = a0 * b1 - a1 * b0; r[2] = a0 * a1 % 2; r[3] = Math.floor(b0 * b1); r[4] = a0 - b0; r[5] = a1 - b1;
  return r;
}
const result = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
console.log(product([1.5, 2.5], [NaN, 3.5], result).join(" "), Object.keys(result).length);
console.log(product([1.5, 2.5], [Infinity, Infinity], result).join(" "), Object.keys(result).length);
console.log(product(result, result, result).join(" "), Object.keys(result).length);
