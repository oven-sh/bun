// Loops over rows that read several elements under constant indexes. Some rows are not as the others are.
const rows = [];
for (let i = 0; i < 24; i++) rows.push([i * 0.5 + 0.25, i * 1.5 - 3.5, 2.75 - i * 0.125]);
function sumAt(i) {
  const a = rows[i];
  return a[0] + a[1] + a[2];
}
function lengthAt(i) {
  const a = rows[i], x = a[0], y = a[1], z = a[2];
  return Math.sqrt(x * x + y * y + z * z);
}
function mixAt(i, k) {
  const a = rows[i];
  return a[2] * k - a[0] / 2 + a[1] * a[1] - a[0];
}
function sums(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + sumAt(i);
  return s;
}
function lengths(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + lengthAt(i);
  return s;
}
function mixes(n, k) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + mixAt(i, k);
  return s;
}
const show = v => (Object.is(v, -0) ? "-0" : "" + v);
function say(name) {
  console.log(name, show(sums(24)), show(lengths(24)), show(mixes(24, 1.5)), show(mixes(8, -2)));
}
say("doubles");
rows[3] = [1, 2, 3];
say("integers");
rows[5] = [1.5, 2];
say("short");
rows[5] = [];
say("empty");
rows[5] = [1.5, , 2.5];
say("hole");
rows[5] = [1.5, undefined, 2.5];
say("undefined");
rows[5] = [1.5, { valueOf() { return 7; } }, 2.5];
say("object");
rows[5] = [NaN, -0, Infinity];
say("NaN");
rows[5] = Object.freeze([0.5, 1.5, 2.5]);
say("frozen");
rows[5] = new Float64Array([0.5, 1.5, 2.5]);
say("view");
rows[5] = [0.5, 1.5, 2.5, 3.5];
rows[23].length = 2;
say("last row short");
rows[23].push(4.5);
say("last row again");
Object.defineProperty(rows[7], 1, { get() { return 9.5; } });
say("getter");
rows[9] = null;
try {
  say("null");
} catch (e) {
  console.log(e.constructor.name);
}
