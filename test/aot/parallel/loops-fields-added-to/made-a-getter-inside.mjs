// A loop adds to fields of an object made ahead of it: the field becomes an accessor in the middle of the loop.
class Acc { constructor() { this.total = 0; this.last = 0; this.text = ""; this.count = 0; } }
const given = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
const both = [a, b, a];
function show(tag) { console.log(tag, a.total, a.last, a.text, a.count, "|", b.total, b.last, b.text, b.count); }
for (let i = 0; i < 50; i++) { a.total += 1; if (i === 25) Object.defineProperty(a, 'total', { get() { return 7; }, set(v) { this.last = v; }, configurable: true }); }
show("end");

