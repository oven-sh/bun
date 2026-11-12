let last = null;
let expected = 0;
const kept = [];
const table = new Map();
function second(value, visit) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  visit(value);
  return work;
}
function borrow(value, visit) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const more = second(value, visit);
  return work + more;
}
function maker(start) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let count = start;
  function bump() { count++; }
  bump();
  borrow(start, x => { last = { read() { return count; }, add() { return ++count; } }; });
  bump();
  expected = count;
  return count + work;
}
let sum = 0;
const wanted = [];
for (let turn = 0; turn < 300; turn++) {
  sum += maker(turn * 10);
  kept.push(last);
  wanted.push(expected);
}
await null;
let wrong = 0;
for (let i = 0; i < kept.length; i++) {
  if (kept[i].read() !== wanted[i]) wrong++;
}
console.log(sum, kept.length, wrong, kept[0].read(), kept[1].read(), kept[299].read());
