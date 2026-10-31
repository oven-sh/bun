// A loop adds to fields of an object made ahead of it: a read of undefined throws in the third turn, and the caller's handler reads the fields.
class Acc { constructor() { this.total = 0; this.last = 0; this.text = ""; this.count = 0; } }
const given = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
const both = [a, b, a];
function show(tag) { console.log(tag, a.total, a.last, a.text, a.count, "|", b.total, b.last, b.text, b.count); }
function run(x, list) { for (let i = 0; i < 50; i++) { x.total += 1; x.count += list[i].length; } } try { run(a, ['a', 'bb', undefined]); } catch (e) { console.log(e.constructor.name); show('caught'); }
show("end");

