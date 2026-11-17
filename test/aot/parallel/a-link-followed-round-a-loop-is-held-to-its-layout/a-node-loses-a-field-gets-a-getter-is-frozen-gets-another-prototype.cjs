function Node(tag, up) { this.tag = tag; this.flags = tag * 3; this.up = up; this.weight = tag + 0.5; }
function chain(n) { let at = null; for (let i = 0; i < n; i++) at = new Node(i, at); return at; }
function climb(from) { let sum = 0; for (let at = from; at !== null; at = at.up) { if (at.flags & 1) sum += at.tag; else sum += at.weight; } return sum; }
const byName = { climb }, key = JSON.parse('"climb"'), leaf = chain(40);
let mid = leaf; for (let i = 0; i < 20; i++) mid = mid.up;
const said = [];
for (let k = 0; k < 4000; k++) { if (k === 800) delete mid.weight; if (k === 1600) Object.defineProperty(mid, 'tag', { get() { return 77; }, configurable: true }); if (k === 2400) Object.freeze(mid.up); if (k === 3200) Object.setPrototypeOf(mid, { weight: 900 }); const got = byName[key](leaf); if (k % 399 === 0) said.push(got); }
console.log(said.join(' '));
