function Node(tag, up) { this.tag = tag; this.flags = tag * 3; this.up = up; this.seen = 0; }
function climb(from) { let sum = 0; for (let at = from; at !== null; at = at.up) { if (at.flags & 1) sum += at.tag; else sum -= at.tag; at.seen = 5; } return sum; }
const byName = { climb }, key = JSON.parse('"climb"');
const low = new Node(3, null), mid = new Node(2, low), top = new Node(1, mid);
const first = byName[key](top);
delete mid.seen; delete mid.tag; mid.tag = 2;
console.log(first, byName[key](top), Object.keys(top).join(), Object.keys(mid).join(), Object.keys(low).join());
