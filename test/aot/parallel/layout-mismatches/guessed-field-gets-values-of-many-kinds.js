// Fields that the constructor fills with null get instances, an array, a function, a fraction, a string, a symbol and a bigint, by name and under a computed key.
const log = [];
function Node1(tag) { this.tag = tag; this.next = null; this.other = null; }
class Leaf { constructor() { this.leaf = true; } }
const a = new Node1(1), b = new Node1(2), c = new Node1(3), d = new Node1(4), e = new Node1(5), f = new Node1(6);
a.next = b; b.next = new Leaf(); c.next = [1, 2]; d.next = () => 7; e.next = 8.5; f.next = "text";
const key = process.argv.length > 99 ? "tag" : "other"; a[key] = c; b[key] = Symbol.for("s"); c[key] = 10n;
for (const node of [a, b, c, d, e, f]) log.push(typeof node.next + ":" + typeof node.other + ":" + (node.next === null) + ":" + (node.next && node.next.tag));
log.push(a.next.next.leaf, c.next.length, d.next(), e.next * 2, f.next.length, a.other.tag);
console.log(log.join("; "));
