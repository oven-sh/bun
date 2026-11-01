// A loop adds to fields of an object made ahead of it: the object is the receiver of a method.
class Acc { constructor() { this.total = 0; this.last = 0; this.text = ""; this.count = 0; } }
const given = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
const both = [a, b, a];
function show(tag) { console.log(tag, a.total, a.last, a.text, a.count, "|", b.total, b.last, b.text, b.count); }
Acc.prototype.run = function (n) { for (let i = 0; i < n; i++) { this.total += 1.5; this.count++; } return this; }; a.run(100); b.run(0); show('mid'); a.run.call(b, 3);
show("end");

