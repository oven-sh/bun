// -0 goes in: a computed minus zero; +0 comes out: for each
const out = [];
function say(x) { out.push(1 / x, x + 1, x === 0, Object.is(x, 0), x | 0, String(x), typeof x); }
class Holder { constructor(v) { this.f = v; } }
let kept;
function give(x) { return x; }
function take(x) { say(x); const h = new Holder(x); say(h.f); kept = x; say(kept); say(give(x)); const list = []; list.push(x); for (let i = 0; i < list.length; i++) say(list[i]); }
const it = new Set(); it.add(0 * -1);
it.forEach((value, key) => take(key));
console.log(out.join(" "));
