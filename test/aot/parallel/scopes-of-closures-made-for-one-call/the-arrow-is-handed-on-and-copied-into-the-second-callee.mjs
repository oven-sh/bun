let last = null;
const kept = [];
function second(value, visit) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  visit(value);
  return work;
}
function first(value, visit) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return second(value + 1, visit) + work;
}
function maker(start) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let count = start;
  function bump() { count++; }
  bump();
  first(start, x => { last = { read: () => count }; });
  bump();
  return count + work;
}
for (let turn = 0; turn < 300; turn++) { maker(turn * 10); kept.push(last); }
let wrong = 0;
for (let i = 0; i < kept.length; i++) if (kept[i].read() !== i * 10 + 2) wrong++;
console.log(kept.length, wrong, kept[0].read(), kept[299].read());
