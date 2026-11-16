// What unrolled iterations step by constants is seen behind the loop, at exits in the middle and where an iteration is run again: several indexes, steps of several sizes and signs, words of wide sums.
function copy(a, i, b, j, n) {
  while (--n >= 0) b[j++] = a[i++];
  return [i, j, n].join();
}
function zip(a, b, out, n) {
  var i = 0, j = n, k = 0;
  for (; k < n; k++) {
    out[k] = (a[i] ^ b[j]) | 0;
    i += 2;
    j -= 1;
  }
  return [i, j, k].join();
}
function find(a, value, from, n) {
  var i = from, j = 0, seen = 0;
  for (var k = 0; k < n; k++) {
    if (a[i] === value) break;
    seen = (seen + a[i] * 3) | 0;
    i += 1;
    j += 3;
  }
  return [i, j, k, seen].join();
}
function carry(a, x, b, c, n) {
  var i = 0, j = 0;
  while (--n >= 0) {
    var l = a[i] & 0x3fff, h = a[i++] >> 14, xl = x & 0x3fff, xh = x >> 14, m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + b[j] + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    b[j++] = l & 0xfffffff;
  }
  return [c, i, j, n].join();
}
function words(a, n) {
  var s = 0, t = 1;
  for (var i = 0; i < n; i++) {
    t = Math.floor((t * 5 + a[i]) / 4);
    s = (s + t) | 0;
    if (t > 100000) return [s, t, i, "left"].join();
  }
  return [s, t, i].join();
}
const list = length => Array.from({ length }, (_, k) => (k * 7919) % 268435455);
for (let round = 0; round < 60; round++) {
  const n = round % 14;
  copy(list(20), round % 3, list(20), round % 2, n);
  zip(list(40), list(40), [], n);
  find(list(20), -1, round % 4, n);
  carry(list(20), 12345678 + round, list(20), 0, n);
  words(list(20), n);
}
const odd = [undefined, -1, 0.5, 2147483648, "9", NaN, -0];
for (let n = 0; n <= 13; n++) {
  console.log(n, copy(list(20), 1, list(20), 2, n), zip(list(40), list(40), [], n), find(list(20), 7919 * 5, 0, n), carry(list(20), 268435455, list(20), 268435455, n), words(list(20), n));
  for (const value of odd) {
    const a = list(20), b = list(20);
    if (n < 12) a[n] = value;
    b[(n * 5) % 11] = value;
    let said;
    try {
      said = [copy(a.slice(), 0, b.slice(), 0, 12), find(a, 7919 * 9, 0, 12), carry(a.slice(), 87654321, b, 3, 12), b.join(), words(a, 12)].join(" ");
    } catch (e) {
      said = e.constructor.name;
    }
    console.log(n, String(value), said);
  }
}
console.log(copy([1, , 3, , 5, 6, 7, 8], 0, [], 0, 8), copy(list(5), 3, list(5), 0, 9), copy(list(5), -2, [], 0, 4), find([1, 2, , 4], 4, 0, 9));
