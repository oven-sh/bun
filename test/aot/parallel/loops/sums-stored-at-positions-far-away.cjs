// STATISTIC: ViewSumNests >= 2
// Positions of sums over views that are integers of 53 bits by their type, far below and far above any view: steps of 2^32 and more, from in front and from behind, two of them that take each other away, cut to words and shifted, read and stored, over one buffer and over two.
const names = JSON.parse("{}"), log = [];
const below = (a, y, z) => { for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k] * 0.5; y[10 - i * 2147483647 * 4000] = s; z[i] = s; } };
const above = (a, y, z) => { for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k] * 0.5; y[3 + i * 4294967296] = s; z[i] = s; } };
const behind = (a, y, z) => { for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k] * 0.25; y[(15 - i) * 8589934592 + 2] = s; z[i] = s; } };
const both = (a, y, z) => { for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k] * 0.5; y[i * 1099511627776 - i * 1099511627775] = s; z[i] = s; } };
const words = (a, y, z) => { for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k] * 0.5; y[(i * 4294967297) | 0] = s; z[i] = s; } };
const shifted = (a, y, z) => { for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k] * 0.5; y[(i * 281474976710656 + i) << 1] = s; z[i] = s; } };
const read = (a, y, z) => { for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k + i * 4294967296] * 0.5; y[i] = s; z[i] = s; } };
const inner = (a, y, z) => { for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[i + k * 8589934592] * 0.5; y[i] = s; z[i] = s; } };
const largest = (a, y, z) => { for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k] * 0.5; y[5 - i * 562949953421311] = s; z[i] = s; } };
const past = (a, y, z) => { for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k] * 0.5; y[5 - i * 2147483647 * 2147483648] = s; z[i] = s; } };
const counted = (a, y, z, n) => { for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k] * 0.5; y[7 - i * 4294967296] = s; z[i] = s; } };
const stepped = (a, y, z) => { let at = 9; for (let i = 0; i < 16; i++) { let s = 0; for (let k = 0; k < 16; k++) s += a[k] * 0.5; y[at] = s; z[i] = s; at -= 4294967296; } };
for (const [name, f] of Object.entries({ below, above, behind, both, words, shifted, read, inner, largest, past, counted, stepped })) {
  Reflect.set(names, name + process.pid, f);
  for (const g of [f, names[name + process.pid]]) {
    let h = 0;
    for (let t = 0; t < 60; t++) {
      const buffer = new ArrayBuffer(400), T = t % 7 === 6 ? Float32Array : Float64Array, a = new T(buffer), y = t % 5 === 4 ? new T(32) : t % 3 === 2 ? new T(buffer, 64) : new T(buffer), z = new Float64Array(20);
      for (let i = 0; i < a.length; i++) a[i] = i + 1;
      g(a, y, z, t % 4 ? 16 : 5 + t % 13);
      const text = Array.from(y).join() + "/" + Array.from(z).join();
      for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 1000003;
      if (t === 0 || t === 33) log.push(name + " " + t + " " + text.slice(0, 120));
    }
    log.push(name + " " + h);
  }
}
console.log(log.join("\n"));
