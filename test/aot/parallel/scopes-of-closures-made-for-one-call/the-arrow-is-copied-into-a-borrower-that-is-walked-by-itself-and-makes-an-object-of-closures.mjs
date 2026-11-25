let last = null;
const kept = [];
function once(value, visit) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  visit(value);
  return work;
}
function maker(start) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let count = start;
  function bump() { count++; }
  bump();
  once(start, x => { last = { read: () => count }; });
  bump();
  return count + work;
}
let sum = 0;
for (let turn = 0; turn < 300; turn++) {
  sum += maker(turn * 10);
  kept.push(last);
}
let wrong = 0;
for (let i = 0; i < kept.length; i++) {
  if (kept[i].read() !== i * 10 + 2) wrong++;
}
console.log(sum, kept.length, wrong, kept[0].read(), kept[1].read());
