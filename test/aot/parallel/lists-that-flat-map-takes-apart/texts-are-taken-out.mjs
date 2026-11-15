const rows = JSON.parse('[["a","b"],["c"]]');
function Rows(i) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return rows[i]; }
const pick = (i) => { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return new Rows(i); };
function join(list) {
  let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0;
  let text = "";
  for (let i = 0; i < list.length; i++) { const v = list[i]; text += typeof v === "string" ? v : "?"; }
  return text;
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = join([0, 1].flatMap(pick));
console.log(last);
