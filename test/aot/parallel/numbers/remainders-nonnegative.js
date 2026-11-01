const show = v => (Object.is(v, -0) ? "-0" : String(v));
const divisors = [0, 1, -1, 2, -2, 3, -3, 7, 10, 40, 4096, 65537, 2147483647, -2147483647, -2147483648, 1073741824];
const dividends = [0, 1, 2, 3, 39, 40, 41, 99999, 65536, 2147483646, 2147483647];
const wide = [0, 1, 4294967295, 4294967296, 4294967297, 1099511627775, 35184372088831, 4503599627370495];
const wideDivisors = [0, 1, -1, 3, 4294967296, -4294967296, 4294967297, 1099511627776, -35184372088832];

function asNumber(x, y) {
  return (x & 0x7fffffff) % (y | 0);
}
function added(x, y, z) {
  return (z | 0) + ((x & 0x7fffffff) % (y | 0));
}
function truncated(x, y) {
  return (x & 0x7fffffff) % (y | 0) | 0;
}
function addedAndTruncated(x, y, z) {
  return ((z | 0) + ((x & 0x7fffffff) % (y | 0))) | 0;
}
function compared(x, y) {
  const r = (x & 0x7fffffff) % (y | 0);
  return (r === 0 ? "zero" : r > 0 ? "more" : r < 0 ? "less" : "none") + (r ? "!" : "?");
}
function asIndex(x, y, list) {
  return list[(x & 0x7fffffff) % (y | 0)];
}
function unsigned(x, y) {
  return (x >>> 0) % (y | 0);
}
function ofWide(x, y) {
  const a = Math.floor(x),
    b = Math.floor(y);
  return a >= 0 && a <= 4503599627370495 && b >= -35184372088832 && b <= 35184372088832 ? a % b : "out";
}
function summed(a, u, n) {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < n; j++) a[i] = a[i] + (j % u);
    a[i] += 5;
  }
  return a.join();
}
function summedInNumbers(a, u, n) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < n; j++) a[i] = a[i] + (j % u);
  return a.map(show).join();
}
function divisorChanges(a, us) {
  for (let j = 0; j < 64; j++) a[j & 3] = a[j & 3] + (j % (us[j % us.length] | 0));
  return a.join();
}
function both(x, y) {
  const r = (x & 0x7fffffff) % (y | 0);
  return show(r) + ":" + (r | 0) + ":" + show(r + 0.5) + ":" + show(-r);
}

const out = [];
const list = ["a", "b", "c", "d", "e", "f", "g"];
for (const y of divisors) {
  for (const x of dividends)
    out.push(
      [
        x,
        y,
        show(asNumber(x, y)),
        show(added(x, y, -7)),
        show(added(x, y, 2147483647)),
        truncated(x, y),
        addedAndTruncated(x, y, 2147483647),
        compared(x, y),
        asIndex(x, y, list),
        show(unsigned(x + 2147483648, y)),
        both(x, y),
      ].join(" "),
    );
  out.push(summed(new Int32Array(3), y | 0, 50));
  out.push(summed(new Int32Array([2147483600, -2147483648, 7]), y | 0, 50));
  out.push(summed(new Uint8Array(3), y | 0, 50));
  out.push(summedInNumbers(new Float64Array(2), y | 0, 20));
  out.push(summedInNumbers([0, -0], y | 0, 20));
}
for (const y of wideDivisors) for (const x of wide) out.push([x, y, show(ofWide(x, y))].join(" "));
out.push(divisorChanges(new Int32Array(4), divisors));
out.push(divisorChanges(new Int32Array(4), [3, 0, 5]));
console.log(out.join("\n"));
