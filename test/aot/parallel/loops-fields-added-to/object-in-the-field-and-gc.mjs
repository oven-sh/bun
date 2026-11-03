// A loop adds to fields of an object made ahead of it: the field holds the head of a list of fresh objects, through many collections.
class Acc { constructor() { this.total = 0; this.last = 0; this.text = ""; this.count = 0; } }
const given = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
const both = [a, b, a];
function show(tag) { console.log(tag, a.total, a.last, a.text, a.count, "|", b.total, b.last, b.text, b.count); }
const o = { head: null }; for (let i = 0; i < 200000; i++) { o.head = { next: i % 1000 ? o.head : null, i }; } let n = 0; for (let c = o.head; c; c = c.next) n += c.i; console.log(n);
show("end");

