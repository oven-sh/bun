class Cell {
  constructor(target) {
    Object.defineProperty(target, "cell", this);
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  }
  set(v) {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    v.n = "text";
  }
}
function make(name) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { name, size: work }; }
function record(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { n, m: work }; }
function kindOf(rec) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof rec.n; }
const box = make("text");
const rec = record(1);
new Cell(box);
console.log(kindOf(rec));
box.cell = rec;
console.log(kindOf(rec));
