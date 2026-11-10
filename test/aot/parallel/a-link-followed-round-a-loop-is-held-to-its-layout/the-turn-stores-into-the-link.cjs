function Node(tag, up) { this.tag = tag; this.flags = tag * 3; this.up = up; this.weight = tag + 0.5; }
function chain(n) { let at = null; for (let i = 0; i < n; i++) at = new Node(i, at); return at; }
function climb(from, cut) { let sum = 0; for (let at = from; at !== null; at = at.up) { sum += at.tag + at.flags; if (at.tag === cut) at.up = at.up === null ? null : at.up.up; } return sum; }
const byName = { climb }, key = JSON.parse('"climb"');
let all = 0; for (let k = 0; k < 2000; k++) all = (all + byName[key](chain(30), k % 30)) % 1000003;
console.log(all);
