// Objects whose constructors store every field, made in several ways, and then read often.
const outside = globalThis[process.argv[2] ?? "Array"];
let total = 0;
function use(x) { total = (total + x) % 1000003; }

function StraightLine(xs) {
  if (!new.target) throw new TypeError("new");
  this.a1 = xs.length;
  this.b1 = 2;
}
function LoopBetween(xs) {
  if (!new.target) throw new TypeError("new");
  this.a2 = 1;
  for (let i = 0; i < xs.length; i++) use(xs[i]);
  this.b2 = 2;
}
function CatchBetween(xs) {
  if (!new.target) throw new TypeError("new");
  try {
    this.a3 = 1;
    use(xs[0]);
    this.b3 = 3;
  } catch {
    this.b3 = 4;
  }
}
function StraightLinePlain(xs) {
  this.a4 = xs.length;
  this.b4 = 2;
}
function LoopBetweenPlain(xs) {
  this.a5 = 1;
  for (let i = 0; i < xs.length; i++) use(xs[i]);
  this.b5 = 2;
}

class Parent { x = 1; }
class Child extends Parent { y = 2; }
class Alone { x = 1; y = 2; }

const list = [1, 2, 3];
const constructors = [StraightLine, LoopBetween, CatchBetween, StraightLinePlain, LoopBetweenPlain];
const made = [];
for (let k = 0; k < constructors.length; k++) {
  const C = constructors[k];
  const row = [];
  for (let i = 0; i < 4; i++) row.push(new C(list));
  made.push(row);
}
const children = [new Child(), new Child()];
const parents = [new Parent(), new Parent()];
const alones = [new Alone(), new Alone()];

outside(made, children, parents, alones);

let sum = 0;
function read1(row) { for (let i = 0; i < 100000; i++) { const p = row[i & 3]; sum = (sum + p.a1 + p.b1) % 1000003; } }
function read2(row) { for (let i = 0; i < 200000; i++) { const p = row[i & 3]; sum = (sum + p.a2 + p.b2) % 1000003; } }
function read3(row) { for (let i = 0; i < 300000; i++) { const p = row[i & 3]; sum = (sum + p.a3 + p.b3) % 1000003; } }
function read4(row) { for (let i = 0; i < 400000; i++) { const p = row[i & 3]; sum = (sum + p.a4 + p.b4) % 1000003; } }
function read5(row) { for (let i = 0; i < 500000; i++) { const p = row[i & 3]; sum = (sum + p.a5 + p.b5) % 1000003; } }
function readChildren(row) { for (let i = 0; i < 600000; i++) { const p = row[i & 1]; sum = (sum + p.x + p.y) % 1000003; } }
function readParents(row) { for (let i = 0; i < 700000; i++) { const p = row[i & 1]; sum = (sum + p.x) % 1000003; } }
function readAlones(row) { for (let i = 0; i < 800000; i++) { const p = row[i & 1]; sum = (sum + p.x + p.y) % 1000003; } }
read1(made[0]); read2(made[1]); read3(made[2]); read4(made[3]); read5(made[4]);
readChildren(children); readParents(parents); readAlones(alones);

class Options { p = 1; q = 2; r = 3; }
const sure = new Options();
const some = [new Options(), new Options()];
function spreadOfSure(o) { const copy = { ...o }; return copy.p + copy.r; }
function spreadOfMaybe(o) { const copy = { ...o }; return copy.p + copy.r; }
for (let i = 0; i < 900000; i++) sum = (sum + spreadOfSure(sure) + spreadOfMaybe(some[i & 1])) % 1000003;
console.log(sum, total);
