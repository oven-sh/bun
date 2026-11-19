function Node(tag, up) { this.tag = tag; this.flags = tag * 3; this.up = up; this.weight = tag + 0.5; }
function chain(n) { let at = null; for (let i = 0; i < n; i++) at = new Node(i, at); return at; }
function climb(from) { let sum = 0; for (let at = from; at !== null; at = at.up) { if (at.flags & 1) sum += at.tag; else sum += at.weight; } return sum; }
const byName = { climb }, key = JSON.parse('"climb"'), leaf = chain(40);
let mid = leaf; for (let i = 0; i < 20; i++) mid = mid.up;
const said = [];
for (let k = 0; k < 3000; k++) { if (k === 1000) mid.up = { tag: 1000, flags: 1, up: mid.up, weight: 0 }; if (k === 2000) mid.up = JSON.parse('{"weight":7,"up":null,"flags":2,"tag":5}'); const got = byName[key](leaf); if (k % 499 === 0) said.push(got); }
console.log(said.join(' '));
