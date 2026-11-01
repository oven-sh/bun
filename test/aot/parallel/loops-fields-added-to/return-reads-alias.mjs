// A loop adds to fields of an object made ahead of it: the loop is left by a return that reads the field through another name.
class Acc { constructor() { this.total = 0; this.last = 0; this.text = ""; this.count = 0; } }
const given = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
const both = [a, b, a];
function show(tag) { console.log(tag, a.total, a.last, a.text, a.count, "|", b.total, b.last, b.text, b.count); }
function run(x, y) { for (let i = 0; i < 50; i++) { x.total += 1.5; if (x.total > given.length) return y.total; } return -1; } console.log(run(a, a)); console.log(run(b, a));
show("end");

