// -0 goes in: set as a key; +0 comes out: spread
const out = [];
function say(x) { out.push(1 / x, x + 1, x === 0, Object.is(x, 0), x | 0, String(x), typeof x); }
class Holder { constructor(v) { this.f = v; } }
let kept;
function give(x) { return x; }
function take(x) { say(x); const h = new Holder(x); say(h.f); kept = x; say(kept); say(give(x)); const list = []; list.push(x); for (let i = 0; i < list.length; i++) say(list[i]); }
const it = new Map(); it.set(-0, 1);
take([...it.keys()][0]);
console.log(out.join(" "));
