// Nests that add up products of elements of views: the sums of several columns are computed side by side. Every number of columns and terms, NaN, infinities, stores among what is read, positions that wrap around or leave the view.
// STATISTIC: ViewSumNests >= 3
function compiled(global, buffer) {
  "use asm";
  var singles = new global.Float32Array(buffer);
  function multiply(columns, terms, into) {
    columns = columns | 0;
    terms = terms | 0;
    into = into | 0;
    var row = 0, column = 0, term = 0, at = 0, sum = 0.0;
    row = 1;
    do {
      column = 1;
      do {
        at = into + (row * 164 | 0) + (column << 2) | 0;
        singles[at >> 2] = 0.0;
        sum = 0.0;
        term = 1;
        do {
          sum = sum + +singles[16 + (row * 164 | 0) + (term << 2) >> 2] * +singles[6744 + (term * 164 | 0) + (column << 2) >> 2];
          term = term + 1 | 0;
        } while ((term | 0) != (terms | 0));
        singles[at >> 2] = sum;
        column = column + 1 | 0;
      } while ((column | 0) != (columns | 0));
      row = row + 1 | 0;
    } while ((row | 0) != 4);
  }
  // Positions wrap around, and the steps of the columns are known at run time.
  function correlate(columns, terms, from, stride, scale) {
    columns = columns | 0;
    terms = terms | 0;
    from = from | 0;
    stride = stride | 0;
    scale = +scale;
    var column = 0, term = 0, first = 0, sum = 0.0, other = 0.0;
    do {
      sum = scale;
      other = 0.0;
      term = 0;
      do {
        sum = sum - +singles[(from + (column * stride | 0) | 0) + (term << 2) >> 2] * scale;
        other = other + (+singles[term << 2 >> 2] + +singles[(column << 2) + (term << 3) >> 2]);
        term = term + 1 | 0;
      } while ((term | 0) < (terms | 0));
      singles[20000 + (column << 2) >> 2] = sum;
      singles[24000 + (column << 3) >> 2] = other;
      column = column + 1 | 0;
    } while ((column | 0) < (columns | 0));
  }
  return { multiply: multiply, correlate: correlate };
}
// The sum enters with a constant; the first store is replaced; what is stored is computed of the sum and of what is there.
function doubles(global, buffer) {
  "use asm";
  var numbers = new global.Float64Array(buffer);
  function smooth(columns, terms, into) {
    columns = columns | 0;
    terms = terms | 0;
    into = into | 0;
    var column = 0, term = 0, sum = 0.0;
    while ((column | 0) < (columns | 0)) {
      sum = 0.5;
      term = 0;
      while ((term | 0) < (terms | 0)) {
        sum = sum + +numbers[column + term << 3 >> 3] / +numbers[300 + term << 3 >> 3];
        term = term + 1 | 0;
      }
      numbers[into + (column << 3) >> 3] = sum * 0.25 + +numbers[into + (column << 3) >> 3];
      column = column + 1 | 0;
    }
  }
  return { smooth: smooth };
}
function product(a, b, c, n) {
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      let sum = 0;
      for (let term = 0; term < n; term++) sum += a[row * n + term] * b[term * n + column];
      c[row * n + column] = sum;
    }
  }
}
let seed = 1;
function next() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}
function fill(view, values) {
  for (let index = 0; index < view.length; index++) {
    const random = next();
    view[index] = random % 7 ? (random % 2000 - 1000) / 64 : values[(random >> 8) % values.length];
  }
}
// Every NaN counts as one.
function hash(view) {
  let result = 7;
  for (let index = 0; index < view.length; index++) {
    const word = view[index];
    result = Math.imul(result ^ ((word & 0x7fffffff) > 0x7f800000 ? 1 : word), 16777619) >>> 0;
  }
  return result;
}
const buffer = new ArrayBuffer(32768), words = new Uint32Array(buffer);
const singles = new Float32Array(buffer), numbers = new Float64Array(buffer);
const { multiply, correlate } = compiled({ Float32Array: Float32Array }, buffer);
const { smooth } = doubles({ Float64Array: Float64Array }, buffer);
const contents = [[0.1, -3], [0, -0], [1e30, -1e30, 1e-30], [Infinity, 2], [NaN, 0.5]];
for (const values of contents) {
  const lines = [];
  for (let columns = 2; columns < 24; columns++) {
    fill(singles, values);
    multiply(columns, 2 + columns, 13472);
    lines.push(hash(words));
  }
  fill(singles, values);
  for (const into of [13472, 16, 180, 6744, 7000, -800, 40000, 2147483600]) {
    multiply(13, 12, into);
    lines.push(hash(words));
    if (hash(words) % 2) fill(singles, values);
  }
  for (const [columns, terms, from, stride] of [[9, 9, 0, 4], [12, 8, 400, 164], [17, 20, 4000, -4], [10, 30, 2147483000, 4], [10, 30, 0, 1073741824], [8, 9, 19960, 8], [8, 9, 100, 2], [30, 16, 100, 0]]) {
    fill(singles, values);
    correlate(columns, terms, from, stride, 0.75);
    lines.push(hash(words));
  }
  for (const [columns, terms, into] of [[8, 8, 8000], [33, 12, 8000], [20, 8, 800], [20, 8, 80], [12, 4000, 16000], [5, 9, 32760], [9, 9, 2360]]) {
    fill(numbers, values);
    smooth(columns, terms, into);
    lines.push(hash(words));
  }
  for (const [first, second] of [[0, 4000], [4000, 4000], [300, 600], [0, 0]]) {
    const a = new Float64Array(buffer, first * 2, 529), b = new Float64Array(buffer, second * 2, 529), c = new Float64Array(buffer, 16000, 529);
    fill(numbers, values);
    product(a, b, c, 23);
    product(b, c, a, 23);
    lines.push(hash(words));
  }
  console.log(lines.join(" "));
}
