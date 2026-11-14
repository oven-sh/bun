// STATISTIC: ArrayRowsHoisted >= 8
// The rows of an array that a function makes are expected to be the arrays that it puts there: c[i] = new Array(n); .. c[i][j] = s. Rows that were replaced, emptied, frozen or given away in the meantime give the answers of the written loop.
const show = value => (value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from(value, (x, i) => (i in value ? show(x) : "!")).join() + "]" + value.length : String(value));
let given;
const table = {
  product(a, b, n, p) {
    const c = [];
    for (let i = 0; i < a.length; i++) {
      c[i] = new Array(p);
      for (let j = 0; j < p; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += a[i][k] * b[k][j];
        c[i][j] = s;
      }
    }
    return c;
  },
  lengths(a, b, n, p) {
    const d = [];
    for (let i = 0; i <= n; i++) {
      d[i] = [];
      for (let j = 0; j <= p; j++) d[i][j] = i === 0 || j === 0 ? 0 : b[i - 1][j - 1] > 0 ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1]);
    }
    return d;
  },
  texts(a, b, n, p) {
    const c = [[], [0.5]];
    for (let i = 0; i < a.length; i++) {
      c[i] = [i];
      for (let j = 1; j < p; j++) {
        let s = j % 5 === 4 ? "x" : 0;
        for (let k = 0; k < n; k++) s += b[k][j];
        c[i][j] = s;
      }
    }
    return c;
  },
  replaced(a, b, n, p) {
    const c = [];
    for (let i = 0; i < a.length; i++) {
      c[i] = new Array(p);
      for (let j = 0; j < p; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) {
          s += b[k][j] * 2;
          if (k === 2 && j === 3) c[i] = i % 2 ? new Float64Array(p) : { length: j };
        }
        c[i][j] = s;
      }
    }
    return c.map(row => Array.from(row));
  },
  givenAway(a, b, n, p) {
    const c = [];
    for (let i = 0; i < a.length; i++) {
      c[i] = new Array(p);
      given = c;
      for (let j = 0; j < p; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += b[k][j] * 2;
        c[i][j] = s;
      }
    }
    return c;
  },
};
const rows = (n, m, f) => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(i, j)));
const makes = [(i, j) => Math.sin(i * 7 + j * 3 + 1), (i, j) => i * 3 - j, (i, j) => (j === 4 ? NaN : i - j / 2), (i, j) => (i === 2 && j === 1 ? "x" + j : -0)];
globalThis["own" + process.pid] = table;
for (const name of Object.keys(table)) {
  const line = [];
  for (const [m, n, p] of [[1, 1, 1], [2, 3, 0], [3, 6, 5], [6, 5, 12]]) {
    let hash = 0;
    for (const make of makes) {
      for (const change of [0, 1, 2, 3]) {
        const a = rows(m, n, make), b = rows(n, p, makes[0]);
        if (change === 1 && n > 2) b[2] = undefined;
        if (change === 2 && p > 3) delete b[0][3];
        if (change === 3 && n > 2)
          Object.defineProperty(b, 1, {
            get() {
              if (given?.[0]) given[0].length = 1;
              if (given?.[1]) Object.freeze(given[1]);
              return b[0];
            },
          });
        let text = "";
        for (let turn = 0; turn < 3; turn++) {
          try {
            text += show(table[name](a, b, n, p));
          } catch (error) {
            text += error.name;
          }
        }
        for (let k = 0; k < text.length; k++) hash = (hash * 31 + text.charCodeAt(k)) | 0;
      }
    }
    line.push(hash);
  }
  console.log(name, line.join());
}
