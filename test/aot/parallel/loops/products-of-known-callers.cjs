// A product of arrays of rows whose callers are in sight: every number of terms and columns, NaN and infinities, results that share rows with the operands.
function product(a, b, c, m, n, p) {
  for (let i = 0; i < m; i++)
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += a[i][k] * b[k][j];
      c[i][j] = s;
    }
  return c;
}
const show = value => (value === undefined ? "u" : Object.is(value, -0) ? "-0" : typeof value === "number" ? String(value) : Array.isArray(value) ? "[" + Array.from(value, show).join() + ":" + value.length + "]" : String(value));
const made = (m, n, f) => Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
const real = (i, j) => Math.sin(i * 7 + j * 3 + 1);
const odd = (i, j) => ((i + j) % 5 ? 1e200 * (j + 1) : i === 1 ? NaN : -1e180);
const whole = (i, j) => ((i * 5 + j * 3) % 7) - 3;
let size = Number(process.argv[2] || 12);
const a = made(size, size, real), b = made(size, size, real), c = made(size, size, real), d = made(size, size, odd), e = made(size, size, whole);
const work = {
  once: () => product(a, b, c, size, size, size),
  few: () => product(a, b, c, 2, 3, 1),
  odd: () => product(a, d, c, size, size, size),
  whole: () => product(e, b, c, size, size, size),
  wholes: () => product(e, e, c, size, 4, 5),
  into: () => product(c, a, c, size, size, 3),
  behind: () => product(a, c, c, 4, size, size),
  shared: () => {
    c[0] = a[0];
    c[1] = b[1];
    c[2] = c[3];
    return product(a, b, c, size, size, size);
  },
};
let hash = 0;
for (let k = 0; k < 3; k++) {
  for (const name of Object.keys(work)) {
    const text = show(work[process.argv[3] || name]()) + show(a) + show(b);
    for (let k = 0; k < text.length; k++) hash = (hash * 31 + text.charCodeAt(k)) | 0;
    console.log(name, hash);
  }
  size -= 3;
}
