const out = [];
const show = value => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value));
function* sums() {
  let sum = 0;
  for (;;) {
    const sent = yield sum;
    sum += sent;
  }
}
function* products() {
  let product = 1;
  for (;;) product *= yield product;
}
function* differences() {
  let left = 0;
  for (;;) {
    const sent = yield left;
    left = sent - left;
  }
}
function* last() {
  let value = 0;
  for (;;) value = yield value;
}
function* counted() {
  let sum = 0;
  let count = 0;
  for (;;) {
    const sent = yield sum;
    sum = sum + sent + 1;
    count++;
    if (count === 5) return [sum, count];
  }
}
const object = {
  valueOf() {
    out.push("valueOf");
    return 4;
  },
};
const kinds = [
  [1, 2, 3, -6, 0, -0],
  [-0, -0, 0],
  [2147483647, 1, -2147483648, -2147483648, -2, 1],
  [0.5, 0.5, 1, 2147483647, 0.25],
  [9007199254740991, 1, 1, -9007199254740991],
  [NaN, 1],
  [Infinity, 1, -Infinity, 2],
  [1, "a", 2, 0.5],
  [1, undefined, 2],
  [1, null, true, 2],
  [1, 5n, 2],
  [1, object, 2, object],
  [1, Symbol.iterator, 2],
  [65536, 65536, 65536],
  [0, -1, 5],
];
for (const generator of [sums, products, differences, last, counted]) {
  for (const values of kinds) {
    const kept = generator();
    kept.next();
    for (const value of values) {
      try {
        const result = kept.next(value);
        out.push(show(result.value) + (result.done ? " done" : ""));
      } catch (error) {
        out.push(error.name);
      }
    }
  }
}
const kept = sums();
kept.next();
let n = 0;
for (let k = 0; k < 100000; k++) n += kept.next(k & 3).value & 7;
out.push(n);
console.log(out.join());
