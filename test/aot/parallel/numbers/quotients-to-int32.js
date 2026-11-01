const divisors = [0, 1, -1, 2, -2, 3, -3, 7, 10, 40, 4096, 65537, 2147483647, -2147483647, -2147483648, 1073741824];
const dividends = [0, 1, -1, 2, -2, 3, -3, 39, -40, 41, -99999, 65536, 2147483647, -2147483647, -2147483648];

function ofEitherSign(x, y) {
  return ((x | 0) / (y | 0)) | 0;
}
function ofNeverNegative(x, y) {
  return ((x & 0x7fffffff) / (y | 0)) | 0;
}
function unsigned(x, y) {
  return ((x >>> 0) / (y | 0)) | 0;
}
function shifted(x, y) {
  return ((x | 0) / (y | 0)) >>> 0;
}
function added(x, y, z) {
  return ((z | 0) + (((x | 0) / (y | 0)) | 0)) | 0;
}
function summed(a, u, n) {
  for (let i = 0; i < a.length; i++) for (let j = -n; j < n; j++) a[i] = (a[i] + ((j / u) | 0)) | 0;
  return a.join();
}
function summedUp(a, u, n) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < n; j++) a[i] += (j / u) | 0;
  return a.join();
}
function leastBy(u, n) {
  let s = 0;
  for (let j = 0; j < n; j++) s = (s + (((-2147483648 + j) / u) | 0)) | 0;
  return s;
}
function divisorChanges(a, us) {
  for (let j = -32; j < 32; j++) a[j & 3] = (a[j & 3] + ((j / (us[(j + 32) % us.length] | 0)) | 0)) | 0;
  return a.join();
}

const out = [];
for (const y of divisors) {
  for (const x of dividends)
    out.push(
      [x, y, ofEitherSign(x, y), ofNeverNegative(x, y), unsigned(x, y), shifted(x, y), added(x, y, 2147483647)].join(
        " ",
      ),
    );
  out.push(
    summed(new Int32Array(2), y | 0, 50),
    summedUp(new Int32Array(2), y | 0, 50),
    summedUp(new Uint8Array(2), y | 0, 50),
    leastBy(y | 0, 5),
  );
}
out.push(divisorChanges(new Int32Array(4), divisors), divisorChanges(new Int32Array(4), [3, 0, -1]));
console.log(out.join("\n"));
