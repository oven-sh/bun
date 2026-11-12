function Node(tag, up) { this.tag = tag; this.flags = tag * 3; this.up = up; this.weight = tag + 0.5; }
function chain(n) { let at = null; for (let i = 0; i < n; i++) at = new Node(i, at); return at; }
const log = [];
let armed = false, now = null;
const boxes = [{ bias: 0 }, { get bias() { if (armed && now !== null && now.tag === 20) { const at = now; armed = false; log.push("deed"); const next = at.up.up; Object.defineProperty(at, "up", { get() { log.push("up"); return next; }, configurable: true }); } return 0; } }], box = boxes[JSON.parse("1")];
function climb(from) { let sum = 0; for (let at = from; at !== null; at = at.up) { const odd = at.flags & 1; now = at; sum += box.bias; if (odd) sum += at.tag; else sum += at.weight; } return sum; }
const byName = { climb }, key = JSON.parse('"climb"'), leaf = chain(40);
let all = 0; for (let k = 0; k < 3000; k++) all = (all + byName[key](leaf)) % 1000003;
console.log("SAID warm " + all);
armed = true;
try { console.log("SAID deed " + String(byName[key](chain(40)))); } catch (error) { console.log("SAID threw " + error.name); }
armed = false;
console.log("SAID after " + String(byName[key](chain(40))));
console.log("SAID log " + (log.join(" ") || "empty"));
