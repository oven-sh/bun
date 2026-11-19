// What an iteration leaves by through either of two checks finds every value where the iteration began.
function add(x, w, i, j, c, n) {
  while (--n >= 0) {
    const l = (x[i] & 0x3fff) * 3 + w[j] + c;
    i++;
    w[j++] = l & 0xffff;
    c = l >> 16;
  }
  return [i, j, c, n, w.join()].join(" ");
}
function pick(a, b, n) {
  let best = -1, at = -1, s = 0;
  for (let i = 0; i < n; i++) {
    const l = a[i] + b[i];
    if (l > best) {
      best = l;
      at = i;
    }
    s = (s + l) | 0;
  }
  return [best, at, s].join();
}
const make = {
  ints: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  wide: k => make.ints().map((v, i) => (i === k ? 5e9 : v)),
  fraction: k => make.ints().map((v, i) => (i === k ? 0.5 : v)),
  hole: k => {
    const a = make.ints();
    delete a[k];
    return a;
  },
  text: k => make.ints().map((v, i) => (i === k ? "7" : v)),
  negative: k => make.ints().map((v, i) => (i === k ? -300000000 : v)),
};
for (let k = 0; k < 11; k++) {
  for (const x in make) {
    for (const w in make) {
      console.log(k, x, w, add(make[x](k), make[w](10 - k), 0, 0, 5, 11), add(make[x](k), make[w](k), 1, 2, 0, 9), pick(make[x](k), make[w](k), 11));
    }
  }
}
