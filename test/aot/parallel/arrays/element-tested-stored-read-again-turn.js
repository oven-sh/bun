// One turn of a loop reads an element, tests it, stores to that element in one arm and reads it again behind the arms.

// Each of these functions sees one list.

function totalLiteral(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = [1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100];
  console.log("Literal", totalLiteral(list), JSON.stringify(Array.from(list)));
}
function totalShort(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = [1, 100, 2];
  console.log("Short", totalShort(list), JSON.stringify(Array.from(list)));
}
function totalPushed(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = (() => {
    const list = [];
    for (const number of [1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100])
      list.push(number);
    return list;
  })();
  console.log("Pushed", totalPushed(list), JSON.stringify(Array.from(list)));
}
function totalFrom(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = Array.from([1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100]);
  console.log("From", totalFrom(list), JSON.stringify(Array.from(list)));
}
function totalMapped(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = [1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100].map(number => number);
  console.log("Mapped", totalMapped(list), JSON.stringify(Array.from(list)));
}
function totalFilled(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = new Array(20).fill(100);
  console.log("Filled", totalFilled(list), JSON.stringify(Array.from(list)));
}
function totalFractions(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = [1.5, 100, 2.5, 100, 100, 5.5, 6.5, 7.5, 100, 9.5, 10.5, 11.5, 100, 13.5];
  console.log("Fractions", totalFractions(list), JSON.stringify(Array.from(list)));
}
function totalMixed(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = ["a", 100, "b", 100, 100, "c", "d", "e", 100, "f", "g", "h", 100];
  console.log("Mixed", totalMixed(list), JSON.stringify(Array.from(list)));
}
function totalInt8(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = new Int8Array([1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100]);
  console.log("Int8", totalInt8(list), JSON.stringify(Array.from(list)));
}
function totalUint8(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = new Uint8Array([1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100]);
  console.log("Uint8", totalUint8(list), JSON.stringify(Array.from(list)));
}
function totalClamped(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = new Uint8ClampedArray([1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100]);
  console.log("Clamped", totalClamped(list), JSON.stringify(Array.from(list)));
}
function totalInt16(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = new Int16Array([1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100]);
  console.log("Int16", totalInt16(list), JSON.stringify(Array.from(list)));
}
function totalUint16(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = new Uint16Array([1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100]);
  console.log("Uint16", totalUint16(list), JSON.stringify(Array.from(list)));
}
function totalInt32(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = new Int32Array([1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100]);
  console.log("Int32", totalInt32(list), JSON.stringify(Array.from(list)));
}
function totalUint32(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = new Uint32Array([1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100]);
  console.log("Uint32", totalUint32(list), JSON.stringify(Array.from(list)));
}
function totalFloat32(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = new Float32Array([1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100]);
  console.log("Float32", totalFloat32(list), JSON.stringify(Array.from(list)));
}
function totalFloat64(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}
{
  const list = new Float64Array([1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100]);
  console.log("Float64", totalFloat64(list), JSON.stringify(Array.from(list)));
}

// Each of these sees every kind of list.

function replacedWhereEqual(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) {
      a[i] = 3;
    }
    s += a[i];
  }
  return s;
}

function replacedWhereNegative(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === -1) a[i] = 0;
    s += a[i];
  }
  return s;
}

function replacedWhereNotEqual(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 100) s += 1000;
    else a[i] = 3;
    s += a[i];
  }
  return s;
}

function replacedWhereGreater(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > 99) a[i] = a[i] - 97;
    s += a[i];
  }
  return s;
}

function replacedInBothArms(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 3;
    else a[i] = a[i] + 1;
    s += a[i];
  }
  return s;
}

function replacedAtAnotherIndex(a, j) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[j] = 3;
    s += a[i];
  }
  return s;
}

function replacedOneAhead(a) {
  let s = 0;
  for (let i = 0; i + 1 < a.length; i++) {
    if (a[i] === 100) a[i + 1] = 3;
    s += a[i + 1];
  }
  return s;
}

function replacedInAWhileLoop(a) {
  let s = 0;
  let i = 0;
  while (i < a.length) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
    i++;
  }
  return s;
}

function replacedInADoLoop(a) {
  let s = 0;
  let i = 0;
  do {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  } while (++i < a.length);
  return s;
}

function replacedFromTheEnd(a) {
  let s = 0;
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] === 100) a[i] = 3;
    s += a[i];
  }
  return s;
}

function replacedBesideAForOf(a) {
  let s = 0;
  let i = 0;
  for (const element of a) {
    if (element === 100) a[i] = 3;
    s += a[i];
    i++;
  }
  return s;
}

function replacedInRows(rows) {
  let s = 0;
  for (let r = 0; r < rows.length; r++) {
    const a = rows[r];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === 100) a[i] = 3;
      s += a[i];
    }
  }
  return s;
}

function replacedByAFraction(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = 0.5;
    s += a[i];
  }
  return s;
}

function replacedByAText(a) {
  let s = "";
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) a[i] = "three";
    s += a[i];
  }
  return s;
}

function replacedWhereItIsANumber(a) {
  let s = "";
  for (let i = 0; i < a.length; i++) {
    if (typeof a[i] === "number") a[i] = "n";
    s += a[i];
  }
  return s;
}

function replacedWhereNothingIsThere(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (!(i in a)) a[i] = 3;
    s += a[i];
  }
  return s;
}

function show(name, answer, list) {
  console.log(name, answer, JSON.stringify(Array.isArray(list) ? list : Array.from(list)));
}

const numbers = () => [1, 100, 2, 100, 100, 5, 6, 7, 100, 9, 10, 11, 100, 13, 14, 15, 16, 100, 18, 100];

function pushed() {
  const list = [];
  for (const number of numbers()) list.push(number);
  return list;
}

const makers = {
  literal: numbers,
  short: () => [1, 100, 2],
  pushed,
  from: () => Array.from(numbers()),
  mapped: () => numbers().map(number => number),
  filled: () => new Array(20).fill(100),
  fractions: () => numbers().map(number => (number === 100 ? 100 : number + 0.5)),
  mixed: () => numbers().map(number => (number === 100 ? 100 : "t" + number)),
  int8: () => new Int8Array(numbers()),
  uint8: () => new Uint8Array(numbers()),
  clamped: () => new Uint8ClampedArray(numbers()),
  int16: () => new Int16Array(numbers()),
  uint16: () => new Uint16Array(numbers()),
  int32: () => new Int32Array(numbers()),
  uint32: () => new Uint32Array(numbers()),
  float32: () => new Float32Array(numbers()),
  float64: () => new Float64Array(numbers()),
};

for (const [name, make] of Object.entries(makers)) {
  let list = make();
  show(name + " equal", replacedWhereEqual(list), list);
  list = make();
  show(name + " not equal", replacedWhereNotEqual(list), list);
  list = make();
  show(name + " greater", replacedWhereGreater(list), list);
  list = make();
  show(name + " both arms", replacedInBothArms(list), list);
  for (const j of [0, 1, 4, 19]) {
    list = make();
    show(name + " another index " + j, replacedAtAnotherIndex(list, j % list.length), list);
  }
  list = make();
  show(name + " one ahead", replacedOneAhead(list), list);
  list = make();
  show(name + " while", replacedInAWhileLoop(list), list);
  list = make();
  show(name + " do", replacedInADoLoop(list), list);
  list = make();
  show(name + " from the end", replacedFromTheEnd(list), list);
  list = make();
  show(name + " for of", replacedBesideAForOf(list), list);
  list = make();
  show(name + " fraction", replacedByAFraction(list), list);
}

{
  const list = [5, -1, 7];
  show("negative", replacedWhereNegative(list), list);
  const rows = [numbers(), [1, 100, 2], pushed()];
  console.log("rows", replacedInRows(rows), JSON.stringify(rows));
  const texts = numbers();
  show("text", replacedByAText(texts), texts);
  const kinds = ["a", 1, "b", 2.5, null, 3, undefined, 4];
  show("typeof", replacedWhereItIsANumber(kinds), kinds);
  const holes = [1, , 2, , , 5, 6, , 8];
  show("in", replacedWhereNothingIsThere(holes), holes);
}
