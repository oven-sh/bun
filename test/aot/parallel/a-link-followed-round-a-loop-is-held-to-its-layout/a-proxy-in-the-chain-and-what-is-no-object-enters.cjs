function Node(tag, up) { this.tag = tag; this.flags = tag * 3; this.up = up; this.weight = tag + 0.5; }
function chain(n) { let at = null; for (let i = 0; i < n; i++) at = new Node(i, at); return at; }
function climb(from) { let sum = 0; for (let at = from; at !== null; at = at.up) { if (at.flags & 1) sum += at.tag; else sum += at.weight; } return sum; }
const byName = { climb }, key = JSON.parse('"climb"'), leaf = chain(12);
let mid = leaf; for (let i = 0; i < 6; i++) mid = mid.up;
let reads = 0; mid.up = new Proxy(mid.up, { get(target, name) { reads++; return target[name]; } });
let all = 0; for (let k = 0; k < 2000; k++) all = (all + byName[key](leaf)) % 1000003;
console.log(all, reads);
try { byName[key](7); console.log('no throw', byName[key](7)); } catch (error) { console.log(error.name); }
try { byName[key](undefined); } catch (error) { console.log(error.name); }
