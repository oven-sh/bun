// A loop adds to fields of an object made ahead of it: the field is private.
class Acc { constructor() { this.total = 0; this.last = 0; this.text = ""; this.count = 0; } }
const given = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
const both = [a, b, a];
function show(tag) { console.log(tag, a.total, a.last, a.text, a.count, "|", b.total, b.last, b.text, b.count); }
class C { #n = 0; run(k) { for (let i = 0; i < k; i++) this.#n += 1.5; return this.#n; } peek() { return this.#n; } } const c = new C(); console.log(c.run(10), c.peek(), c.run(0), c.peek());
show("end");

