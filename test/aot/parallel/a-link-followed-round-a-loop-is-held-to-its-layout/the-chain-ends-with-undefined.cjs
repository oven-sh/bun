function Node(tag, up) { this.tag = tag; this.flags = tag * 3; this.up = up; this.weight = tag + 0.5; }
function chain(n) { let at = null; for (let i = 0; i < n; i++) at = new Node(i, at); return at; }
function chainU(n) { let at; for (let i = 0; i < n; i++) at = new Node(i, at); return at; }
function climb(from) { let sum = 0; for (let at = from; at; at = at.up) { if (at.flags & 1) sum += at.tag; else sum += at.weight; } return sum; }
const byName = { climb }, key = JSON.parse('"climb"'), leaf = chainU(40);
let all = 0; for (let k = 0; k < 3000; k++) all = (all + byName[key](leaf)) % 1000003;
console.log(all);
