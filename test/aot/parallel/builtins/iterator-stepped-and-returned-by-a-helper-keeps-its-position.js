// A helper makes the collection itself, steps its iterator and returns it, and is called from two places. The caller rebuilds the iterator that the helper did not allocate, and the steps have to stay.
const elsewhere = process.argv.length;
function list(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i);
  return a;
}
function map(n) {
  const m = new Map();
  for (let i = 0; i < n; i++) m.set(i, i * 10);
  return m;
}
function set(n) {
  const s = new Set();
  for (let i = 0; i < n; i++) s.add(i);
  return s;
}
function record(n) {
  const o = {};
  for (let i = 0; i < n; i++) o["k" + i] = i;
  return o;
}
function skipFirst(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i);
  const it = a.values();
  it.next();
  return it;
}
console.log(skipFirst(3).next().value, skipFirst(elsewhere + 3).next().value);
function listKeysTwice(n) {
  const a = list(n);
  const it = a.keys();
  it.next();
  it.next();
  return it;
}
console.log([...listKeysTwice(4)], [...listKeysTwice(elsewhere + 3)]);
function listEntries(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push("v" + i);
  const it = a.entries();
  it.next();
  return it;
}
console.log([...listEntries(3)], [...listEntries(elsewhere + 2)]);
function mapKeys(n) {
  const m = new Map();
  for (let i = 0; i < n; i++) m.set(i, i * 10);
  const it = m.keys();
  it.next();
  it.next();
  return it;
}
console.log([...mapKeys(4)], [...mapKeys(elsewhere + 3)]);
function mapValues(n) {
  const m = map(n);
  const it = m.values();
  it.next();
  return it;
}
console.log(mapValues(3).next().value, mapValues(elsewhere + 3).next().value);
function mapEntries(n) {
  const m = new Map();
  for (let i = 0; i < n; i++) m.set("k" + i, i);
  const it = m.entries();
  it.next();
  return it;
}
console.log([...mapEntries(3)], [...mapEntries(elsewhere + 2)]);
function setValues(n) {
  const s = new Set();
  for (let i = 0; i < n; i++) s.add(i);
  const it = s.values();
  it.next();
  return it;
}
console.log(setValues(3).next().value, setValues(elsewhere + 3).next().value);
function setEntries(n) {
  const s = set(n);
  const it = s.entries();
  it.next();
  it.next();
  return it;
}
console.log([...setEntries(4)], [...setEntries(elsewhere + 3)]);
function keysOfRecord(n) {
  const it = Object.keys(record(n)).values();
  it.next();
  return it;
}
console.log(keysOfRecord(3).next().value, keysOfRecord(elsewhere + 3).next().value);
function entriesOfRecord(n) {
  const it = Object.entries(record(n)).values();
  it.next();
  return it;
}
console.log(entriesOfRecord(3).next().value, entriesOfRecord(elsewhere + 3).next().value);
function steppedToTheEnd(n) {
  const a = list(n);
  const it = a.values();
  for (let i = 0; i <= n; i++) it.next();
  return it;
}
console.log(steppedToTheEnd(2).next(), steppedToTheEnd(elsewhere + 1).next());
function notStepped(n) {
  const it = list(n).values();
  return it;
}
console.log(notStepped(2).next().value, notStepped(elsewhere + 1).next().value);
function steppedOnOneWay(n, step) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i);
  const it = a.values();
  if (step) it.next();
  return it;
}
console.log(steppedOnOneWay(3, true).next().value, steppedOnOneWay(elsewhere + 2, false).next().value);
function collectionChangedBehindTheStep(n) {
  const m = new Map();
  for (let i = 0; i < n; i++) m.set(i, i);
  const it = m.keys();
  it.next();
  m.delete(1);
  m.set(99, 99);
  return it;
}
console.log([...collectionChangedBehindTheStep(3)], [...collectionChangedBehindTheStep(elsewhere + 3)]);
