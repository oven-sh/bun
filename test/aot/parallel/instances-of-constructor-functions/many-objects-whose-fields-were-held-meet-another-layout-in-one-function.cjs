const count = +process.argv[2] || 300000;
function Knot(tag, name) { this.tag = tag; this.name = name; this.up = null; }
function Plain(name) { this.name = name; this.up = null; }
function link(below, above) { below.up = above; }
function fill(knot, word, value) { knot[word] = value; }
const knot = new Knot(1, "a"); link(knot, new Knot(2, "b")); fill(knot, JSON.parse('"name"'), 7);
const kept = []; let last = new Plain("first");
for (let i = 0; i < count; i++) { const next = new Plain(i & 1 ? "odd" : "even"); link(next, last); kept.push(next); last = next; }
let sum = 0; for (let round = 0; round < 20; round++) for (let i = 0; i < kept.length; i++) { const plain = kept[i]; sum += plain.name.length + (plain.up.up === null ? 1 : 0); }
console.log(sum, kept.length, String(knot.name));
