class Crate { constructor(size) { this.size = size; } }
function wide(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return new Crate(n + work);
}
function narrow(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return new Crate(n - work);
}
function wa(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return [n + work, 1];
}
function wb(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return [n - work, 2];
}
const pick2 = Date.now() > 5 ? wa : wb;
const pick = Date.now() > 5 ? wide : narrow;
function main() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let count = 5;
  const full = { note: 1, read: () => count, add: () => ++count, box: pick2(3) };
  const found = full.box;
  console.log(typeof found, "box" in full, full.add(), full.read(), work);
  if (Date.now() < 5) delete full.note;
}
main();
