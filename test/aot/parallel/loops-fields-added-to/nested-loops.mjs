// A loop adds to fields of an object made ahead of it: an inner loop adds and the outer one reads.
class Acc { constructor() { this.total = 0; this.last = 0; this.text = ""; this.count = 0; } }
const given = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
const both = [a, b, a];
function show(tag) { console.log(tag, a.total, a.last, a.text, a.count, "|", b.total, b.last, b.text, b.count); }
for (let j = 0; j < 10; j++) { for (let i = 0; i < 10; i++) { a.total += j; } a.count += a.total; b.total = a.count; }
show("end");

