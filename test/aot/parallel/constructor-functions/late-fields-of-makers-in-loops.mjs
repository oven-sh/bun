// Makers that a loop alone calls store names behind the construction that the class does not list. A build that checks proofs asks for each.
let made = 0;
class Plain { constructor(x) { this.a = x; this.d = x; } }
function Pair(x) { this.a = x; this.d = x; }
class Setter { set b(v) { made += 10; } constructor(x) { this.a = x; this.b = x; } }
function plain(x) { const o = new Plain(x); o.late = "after"; return o; }
function sometimes(x) { const o = new Plain(x); o.call = () => x; if (x > 0) o.other = made++; o.other = "after"; return o; }
function pair(x) { const o = new Pair(x); o.more = "after"; return o; }
function literal(x) { const o = { x }; o.z = o.x; return o; }
function setter(x) { const o = new Setter(x); o.call = () => x; if (x > 0) o.third = made++; const handed = o; o.third = "after"; return handed; }
function plains() { let s = ""; for (let i = 0; i < 4; i++) { const v = plain(i), w = plain(2); s += v.a + v.late + (w === v) + " "; } return s; }
function some() { let s = ""; for (let i = 0; i < 4; i++) { const v = sometimes(i), w = sometimes(2); s += v.a + v.other + v.call() + (w === v) + " "; } return s; }
function pairs() { let s = ""; for (let i = 0; i < 4; i++) { const v = pair(i), w = pair(2); s += v.a + v.more + (w === v) + " "; } return s; }
function literals() { let s = ""; for (let i = 0; i < 4; i++) { const v = literal(i), w = literal(2); s += v.x + v.z + (w === v) + Object.keys(v) + " "; } return s; }
function setters() { let s = ""; for (let i = 0; i < 4; i++) { const v = setter(i), w = setter(2); s += v.a + v.third + v.call() + (w === v) + " "; } return s; }
console.log(plains(), some(), pairs(), literals(), setters());
console.log(plains(), some(), pairs(), literals(), setters(), made);
