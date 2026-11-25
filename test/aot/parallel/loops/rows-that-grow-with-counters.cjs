// STATISTIC: RowStoresMaybeAppending >= 4
// Rows that start as a literal of constants, [] above all, grow with the counter of the loop that fills them: c[i] = []; for (..) c[i][j] = ... Rows that end, change or are no arrays in the meantime give the answers of the written loop.
const show = value => (value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from(value, (x, i) => (i in value ? show(x) : "!")).join() + "]" + value.length : String(value));
const table = {
  halves(a, n, m) {
    const c = [];
    for (let i = 0; i < n; i++) {
      c[i] = [];
      for (let j = 0; j < m; j++) c[i][j] = j * 0.5;
    }
    return c;
  },
  transpose(a, n, m) {
    const c = [];
    for (let j = 0; j < m; j++) {
      c[j] = [];
      for (let i = 0; i < n; i++) c[j][i] = a[i][j];
    }
    return c;
  },
  doubled(a, n, m) {
    const c = [];
    for (let i = 0; i < n; i++) {
      c[i] = [];
      for (let j = 0; j < m; j++) c[i][j] = a[i][j] * 2;
    }
    return c;
  },
  common(a, n, m) {
    const d = [];
    for (let i = 0; i <= n; i++) {
      d[i] = [];
      for (let j = 0; j <= m; j++) d[i][j] = i === 0 || j === 0 ? 0 : a[i - 1][j - 1] > 0 ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1]);
    }
    return d;
  },
  behindTwo(a, n, m) {
    const c = [];
    for (let i = 0; i < n; i++) {
      c[i] = [1, 1];
      for (let j = 2; j < m; j++) c[i][j] = c[i][j - 1] + c[i][j - 2];
    }
    return c;
  },
  fromOne(a, n, m) {
    const c = [];
    for (let i = 0; i < n; i++) {
      c[i] = [];
      for (let j = 1; j < m; j++) c[i][j] = a[i][j];
    }
    return c;
  },
  texts(a, n, m) {
    const c = [];
    for (let i = 0; i < n; i++) {
      c[i] = [];
      for (let j = 0; j < m; j++) c[i][j] = j % 3 ? a[i][j] : "t" + j;
    }
    return c;
  },
  replaced(a, n, m) {
    const c = [];
    for (let i = 0; i < n; i++) {
      c[i] = [];
      for (let j = 0; j < m; j++) {
        c[i][j] = a[i][j];
        if (j === 4) c[i] = [0.5];
      }
    }
    return c;
  },
  ended(a, n, m) {
    const c = [];
    for (let i = 0; i < n; i++) {
      c[i] = [];
      for (let j = 0; j < m; j++) {
        if (j === 3) c[i].length = 1;
        if (i === 1 && j === 5) Object.freeze(c[i]);
        c[i][j] = a[i][j] + 0.25;
      }
    }
    return c;
  },
};
const rows = (n, m, f) => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(i, j)));
const makes = [(i, j) => Math.sin(i * 7 + j * 3 + 1), (i, j) => i * 3 - j, (i, j) => (j === 4 ? NaN : i - j), (i, j) => (i === 2 ? "x" + j : -0)];
globalThis["growing" + process.pid] = table;
for (const name of Object.keys(table)) {
  const line = [];
  for (const [n, m] of [[1, 1], [2, 0], [3, 6], [4, 30], [2, 300]]) {
    let hash = 0;
    for (const make of makes) {
      for (const change of [0, 1, 2]) {
        const a = rows(n, m, make);
        if (change === 1 && n > 1) a[1] = undefined;
        if (change === 2 && m > 3) delete a[0][3];
        let text = "";
        for (let turn = 0; turn < 3; turn++) {
          try {
            text += show(table[name](a, n, m));
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
