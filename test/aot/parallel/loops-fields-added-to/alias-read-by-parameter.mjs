// A loop adds to fields of an object made ahead of it: two parameters may be one object, and the other one is read.
class Acc { constructor() { this.total = 0; this.last = 0; this.text = ""; this.count = 0; } }
const given = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
const both = [a, b, a];
function show(tag) { console.log(tag, a.total, a.last, a.text, a.count, "|", b.total, b.last, b.text, b.count); }
function run(x, y) { let seen = 0; for (let i = 0; i < 300; i++) { x.total += 1; seen += y.total; } return seen; } console.log(run(a, b)); console.log(run(a, a));
show("end");

