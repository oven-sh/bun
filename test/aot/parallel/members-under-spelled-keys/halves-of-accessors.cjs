// Sloppy code: a getter alone, a setter alone, and both, under symbols and under texts in constants.
const onlyGet = Symbol("onlyGet"), onlySet = Symbol(), both = Symbol.for("both"), word = "word";
class Cell {
  constructor(v) { this.v = v; }
  get [onlyGet]() { return this.v; }
  set [onlySet](x) { this.v = x; }
  get [both]() { return this.v + 1; }
  set [both](x) { this.v = x - 1; }
  get [word]() { return "w" + this.v; }
  static get [onlyGet]() { return "static"; }
}
class Strict extends Cell {
  store(x) { "use strict"; this[onlyGet] = x; }
  set [both](x) { super[both] = x * 2; }
}
function run(cells) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let sum = "";
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    c[onlyGet] = 99;
    c[onlySet] = i;
    c[both] = c[onlyGet] + 2;
    c.word = "ignored";
    if (i > cells.length - 4) sum += [c[onlyGet], c[onlySet], c[both], c[word], Cell[onlyGet], Object.keys(c).join()].join("|") + " ";
  }
  return sum + work;
}
const cells = [];
for (let i = 0; i < 500; i++) cells.push(i % 5 ? new Cell(i) : new Strict(i));
console.log(run(cells));
try { cells[0].store(1); } catch (e) { console.log(e.name); }
