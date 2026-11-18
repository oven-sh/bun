// Nests that add up products of elements of flat arrays: the sums of several columns are computed side by side. Arrays of other kinds, holes, NaN, results that are read, too short, frozen or of accessors go to the written loop.
// STATISTIC: ViewSumNests >= 1
function multiply(a, b, c, n) {
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      let sum = 0;
      for (let term = 0; term < n; term++) sum += a[row * n + term] * b[term * n + column];
      c[row * n + column] = sum;
    }
  }
}
const n = 12;
let seed = 7;
function next() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}
function make(length) {
  const result = [];
  for (let index = 0; index < length; index++) result.push((next() % 2000 - 1000) / 64 + 0.125);
  return result;
}
function show(array) {
  let result = array.length + ":", hash = 7;
  for (let index = 0; index < array.length; index++) {
    const value = array[index];
    if (!(index in array)) result += index + "_";
    else if (value !== value) result += index + "n";
    else if (Object.is(value, -0)) result += index + "m";
    else hash = Math.imul(hash ^ (value * 4096), 16777619) >>> 0;
  }
  return result + hash;
}
const lines = [];
function run(a, b, c) {
  multiply(a, b, c, n);
  lines.push(show(c));
}
const size = n * n;
run(make(size), make(size), make(size));
run(make(size), make(size), []);
run(make(size), make(size), make(size - 5));
run(make(size - 5), make(size), make(size));
const first = make(size), second = make(size);
run(first, second, first);
run(first, second, second);
run(second, second, second);
const withHole = make(size);
delete withHole[17];
run(withHole, make(size), make(size));
run(make(size), make(size), withHole);
const withNothing = make(size);
withNothing[30] = NaN;
run(withNothing, make(size), make(size));
run(make(size), make(size), withNothing);
const withInfinity = make(size);
withInfinity[40] = Infinity;
withInfinity[41] = -Infinity;
run(withInfinity, make(size), make(size));
const zeros = make(size).map(value => -0);
run(zeros, make(size), make(size));
run(make(size).map(value => value | 0), make(size), make(size));
run(make(size), make(size), new Array(size).fill(0));
run([0.5, 1.5, 2.5], make(size), make(size));
const texts = make(size);
texts[3] = "2";
texts[4] = undefined;
run(texts, make(size), make(size));
run(make(size), make(size), texts);
const frozen = Object.freeze(make(size));
run(frozen, make(size), make(size));
run(make(size), make(size), frozen);
const accessors = make(size);
let stored = 0;
Object.defineProperty(accessors, 20, { get() { first[3] = 0.25; return 1.5; }, set(value) { stored += value; second[5] = 0.75; }, configurable: true });
run(accessors, first, make(size));
run(first, second, accessors);
lines.push(String(stored));
run(make(size), make(size), make(size));
console.log(lines.join("\n"));
