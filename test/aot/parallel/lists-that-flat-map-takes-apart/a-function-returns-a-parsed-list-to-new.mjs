const rows = JSON.parse("[[1,2],[3]]");
function Rows(i) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return rows[i]; }
const pick = (i) => { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return new Rows(i); };
function count(list) {
  let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0;
  let numbers = 0;
  for (let i = 0; i < list.length; i++) { const v = list[i]; if (typeof v === "number") numbers++; }
  return numbers;
}
let total = 0;
for (let turn = 0; turn < 300; turn++) total += count([0, 1].flatMap(pick));
console.log(total);
