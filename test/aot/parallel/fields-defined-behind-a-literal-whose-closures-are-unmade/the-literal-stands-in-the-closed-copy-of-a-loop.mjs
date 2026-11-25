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
function run(n) {
  let lost = 0;
  let absent = 0;
  let work = 0;
  for (let i = 0; i < n; i++) {
    let count = i;
    const full = { note: 1, read: () => count, add: () => ++count, box: pick(i) };
    if (typeof full.box !== "object") lost++;
    if (!("box" in full)) absent++;
    work += full.add() + full.read();
    if (Date.now() < 5) delete full.note;
  }
  return lost + " " + absent + " " + work;
}
console.log(run(300));
console.log(run(JSON.parse('"3"')));
