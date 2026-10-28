// Untyped object literals with 0 to 12 properties: each is evaluated 3 times, then 10,000 times across forced collections, and its values are read again after it. A literal with the same names in another order, a null prototype, an index key or a duplicate name does not share its structure. One object of each literal is stored to by a computed key, so every literal here creates an ordinary object.
// CALLS+ make0 NewOrdinaryObject\.n0
// CALLS+ make2 NewOrdinaryObject\.n2
// CALLS+ make12 NewOrdinaryObject\.n[46]
// CALLS+ withIndexKey NewOrdinaryObject
// CALLS- withIndexKey NewOrdinaryObject\.n3
let sum = 0;
function make0() { const o = {}; return o; }
function make1(a) { const o = { a }; sum += a; return o; }
function make2(a, b) { const o = { a, b }; sum += a + b; return o; }
function make3(a, b, c) { const o = { a, b, c }; sum += a + b + c; return o; }
function make4(a, b, c, d) { const o = { a, b, c, d }; sum += a + b + c + d; return o; }
function make5(a, b, c, d, e) { const o = { a, b, c, d, e }; sum += a + b + c + d + e; return o; }
function make6(a, b, c, d, e, f) { const o = { a, b, c, d, e, f }; sum += a + b + c + d + e + f; return o; }
function make7(a, b, c, d, e, f, g) { const o = { a, b, c, d, e, f, g }; sum += a + b + c + d + e + f + g; return o; }
function make8(a, b, c, d, e, f, g, h) { const o = { a, b, c, d, e, f, g, h }; sum += a + b + c + d + e + f + g + h; return o; }
function make9(a, b, c, d, e, f, g, h, i) { const o = { a, b, c, d, e, f, g, h, i }; sum += a + b + c + d + e + f + g + h + i; return o; }
function make10(a, b, c, d, e, f, g, h, i, j) { const o = { a, b, c, d, e, f, g, h, i, j }; sum += a + b + c + d + e + f + g + h + i + j; return o; }
function make11(a, b, c, d, e, f, g, h, i, j, k) { const o = { a, b, c, d, e, f, g, h, i, j, k }; sum += a + b + c + d + e + f + g + h + i + j + k; return o; }
function make12(a, b, c, d, e, f, g, h, i, j, k, l) { const o = { a, b, c, d, e, f, g, h, i, j, k, l }; sum += a + b + c + d + e + f + g + h + i + j + k + l; return o; }
const makers = [make0, make1, make2, make3, make4, make5, make6, make7, make8, make9, make10, make11, make12];

function prototypeName(o) {
  const prototype = Object.getPrototypeOf(o);
  return prototype === null ? "null" : prototype === Object.prototype ? "Object.prototype" : "other";
}
function describe(o) {
  return `${JSON.stringify(o)} [${Object.keys(o).join()}] ${prototypeName(o)}`;
}
function total(o) {
  let result = 0;
  for (const key in o) result += o[key];
  return result;
}
function numbersFor(round, count) {
  const numbers = [];
  for (let index = 0; index < count; index++) numbers.push(index % 3 === 2 ? round + index + 0.5 : round * (index + 1));
  return numbers;
}

for (let count = 0; count < makers.length; count++) {
  const make = makers[count];
  const [first, second, third] = [1, 2, 3].map(round => make(...numbersFor(round, count)));
  const recent = new Array(8);
  const survivors = [];
  let last;
  for (let round = 4; round < 10_004; round++) {
    last = make(...numbersFor(round, count));
    recent[round % recent.length] = last;
    if (round % 1_000 === 0) {
      survivors.push(last);
      Bun.gc(true);
    }
  }
  console.log(count, "first", describe(first));
  console.log(count, "second", describe(second));
  console.log(count, "last", describe(last));
  third.later = "added";
  third[`latest${count}`] = count;
  console.log(count, "extended", describe(third));
  console.log(count, "totals", recent.map(total).join(), "|", survivors.map(total).join());
}
console.log("sum", sum);

const mixed = [1, "two", null, undefined, true, 2.5, [7], { nested: 8 }, -0, "", NaN, false];
sum = "";
for (let count = 0; count < makers.length; count++) console.log(count, "mixed", describe(makers[count](...mixed.slice(0, count))));
console.log("concatenated", sum);

function reordered(a, b, c) { const o = { c, a, b }; sum += a + b + c; return o; }
function withNullPrototype(a, b, c) { const o = { __proto__: null, a, b, c }; sum += a + b + c; return o; }
function withIndexKey(a, b, c) { const o = { a, 1: b, c }; sum += a + b + c; return o; }
function withDuplicateName(a, b, c) { const o = { a, b, a: c }; sum += a + b + c; return o; }
const variants = [make3, reordered, withNullPrototype, withIndexKey, withDuplicateName];
sum = 0;
const earliest = variants.map(make => make(1, 2, 3));
const latest = [];
for (let round = 0; round < 10_000; round++) {
  for (let index = 0; index < variants.length; index++) latest[index] = variants[index](round, round + 1, round + 2);
  if (round % 1_000 === 0) Bun.gc(true);
}
earliest.forEach((o, index) => { o[`later${index}`] = index; });
variants.forEach((make, index) => console.log(make.name, describe(earliest[index]), "|", describe(latest[index]), "|", "toString" in latest[index]));
console.log("sum", sum);
