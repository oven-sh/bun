// Plain functions over arrays of rows: sums over rows and columns that are stored into rows and vectors. Results share rows with the operands, rows are of every kind, short, missing, with holes and NaN.
const show = value => (value === undefined ? "u" : Object.is(value, -0) ? "-0" : typeof value === "number" ? String(value) : Array.isArray(value) ? "[" + Array.from(value, show).join() + ":" + value.length + "]" : value instanceof Float64Array ? "F" + [...value].map(show) : String(value));
const table = {
  product(a, b, c, v, w, m, n, p) {
    for (let i = 0; i < m; i++)
      for (let j = 0; j < p; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += a[i][k] * b[k][j];
        c[i][j] = s;
      }
    return c;
  },
  rows(a, b, c, v, w, m, n, p) {
    for (let i = 0; i < m; i++)
      for (let j = 0; j < p; j++) {
        let s = 0.5;
        for (let k = 0; k < n; k++) s += a[i][k] * b[j][k];
        c[i][j] = s;
      }
    return c;
  },
  columns(a, b, c, v, w, m, n, p) {
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += v[k] * b[k][j];
      w[j] = s;
    }
    return w;
  },
  into(a, b, c, v, w, m, n, p) {
    for (let j = 0; j < p; j++)
      for (let i = 0; i < m; i++) {
        let s = 0;
        for (let k = 0; k < n; k++) s -= a[i][k] * b[k][j];
        a[i][j] = s;
      }
    return a;
  },
};
const made = (m, n, f) => Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
const real = (i, j) => Math.sin(i * 7 + j * 3 + 1);
const whole = (i, j) => ((i * 5 + j * 3) % 7) - 3;
const changes = [
  x => x,
  x => ((x[x.length >> 1][x[0].length >> 1] = NaN), x),
  x => ((x[x.length - 1][0] = Infinity), x),
  x => (delete x[x.length >> 1][x[0].length - 1], x),
  x => (delete x[x.length >> 1], x),
  x => ((x[x.length - 1] = x[0]), x),
  x => ((x[x.length >> 1] = x[x.length >> 1].slice(0, x[0].length >> 1)), x),
  x => ((x[x.length >> 1] = new Float64Array(x[x.length >> 1])), x),
  x => ((x[x.length >> 1] = x[x.length >> 1].map(Math.round)), x),
];
const shares = [() => {}, (a, b, c) => (c[0] = a[0]), (a, b, c) => (c[c.length - 1] = b[0]), (a, b, c) => (c[0] = c[c.length - 1]), (a, b, c, v) => (c[0] = v), (a, b) => (b[0] = a[0])];
let hash = 0;
for (const name of Object.keys(table)) {
  for (const [m, n, p] of [[1, 1, 1], [2, 2, 3], [4, 3, 8], [3, 5, 9], [5, 16, 17], [9, 4, 20]]) {
    for (const kind of [real, whole]) {
      for (const change of changes) {
        for (const share of shares) {
          const size = Math.max(m, n, p);
          const a = change(made(size, size, kind)), b = change(made(size, size, real)), c = change(made(size, size, real)), v = made(1, size, real)[0], w = made(1, size, kind)[0];
          share(a, b, c, v);
          let text;
          try {
            text = show(table[name](a, b, c, v, w, m, n, p));
          } catch (error) {
            text = error.name;
          }
          text += show(a) + show(b) + show(c) + show(v) + show(w);
          for (let k = 0; k < text.length; k++) hash = (hash * 31 + text.charCodeAt(k)) | 0;
        }
      }
    }
    console.log(name, m, n, p, hash);
  }
}
