// A loop adds to fields of an object made ahead of it: the object hangs on the global object.
class Acc { constructor() { this.total = 0; this.last = 0; this.text = ""; this.count = 0; } }
const given = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
const both = [a, b, a];
function show(tag) { console.log(tag, a.total, a.last, a.text, a.count, "|", b.total, b.last, b.text, b.count); }
globalThis.kept = a; for (let i = 0; i < 1000; i++) { a.last = given[i & 7]; a.total += a.last; }
show("end");

