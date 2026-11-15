const kept = [];
const items = [1, 2];
function each(list, visit) {
  let work = 0;
  for (let i = 0; i < 2; i++) {
    work = (work * 3 + 1) | 0; work = (work * 5 + 2) | 0; work = (work * 7 + 3) | 0;
    work = (work * 3 + 4) | 0; work = (work * 5 + 5) | 0; work = (work * 7 + 6) | 0;
    work = (work * 3 + 7) | 0; work = (work * 5 + 8) | 0; work = (work * 7 + 9) | 0;
  }
  for (let i = 0; i < list.length; i++) visit(list[i]);
  return work;
}
function maker(start) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let count = start;
  function bump() { count++; }
  bump();
  each(items, x => { kept.push({ read: () => count }); });
  bump();
  return count + work;
}
for (let turn = 0; turn < 300; turn++) maker(turn * 10);
let wrong = 0;
for (let i = 0; i < kept.length; i++) if (kept[i].read() !== (i >> 1) * 10 + 2) wrong++;
console.log(kept.length, wrong, kept[0].read(), kept[2].read());
