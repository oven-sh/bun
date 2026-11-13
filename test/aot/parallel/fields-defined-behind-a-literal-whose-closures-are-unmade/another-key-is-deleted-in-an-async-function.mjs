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
const pick = Date.now() > 5 ? wide : narrow;
async function main() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let count = 5;
  const full = { note: 1, read: () => count, add: () => ++count, box: pick(3) };
  const found = full.box;
  console.log(typeof found, "box" in full, full.add(), full.read(), work);
  if (Date.now() < 5) delete full.note;
  await null;
  console.log(typeof full.box, full.read());
}
await main();
