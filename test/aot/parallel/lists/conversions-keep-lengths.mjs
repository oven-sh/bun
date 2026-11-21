// The version that converts the array to doubles is in front of versions that test presence under the length read before the loop.
function run(a, b, n) {
  let s = 0;
  let t = 0;
  const length = a.length;
  for (let i = 0; i < length; i++) {
    a[i] = Math.max(a[i], b[i]);
  }
  return [s, t];
}
const show = x => (Object.is(x, -0) ? '-0' : String(x));
for (let turn = 0; turn < 3; turn++) {
  const a = Array.from({ length: 1 }, (_, k) => 250 + (k % 12));
  let b = Array.from({ length: 1 }, (_, k) => 250 + (k % 12)).reverse();
  b = a;
  console.log(run(a, b, 0).map(show).join(), Array.from(a, show).join().slice(0, 500));
}
