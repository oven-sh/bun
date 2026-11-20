// The callee changes its rest list. Whoever spread a list that he goes on reading, or spreads again in the next turn, finds it as it was.
class Taker { take(a, b, ...rest) { const seen = rest.join(); rest.push("pushed"); rest[0] = "stored"; rest.shift(); return a + b + ":" + seen; } }
function readsBehind(taker, ...values) { const out = taker.take(1, 2, ...values); return out + "|" + values.join() + "|" + values.length; }
function spreadsInTurns(taker, ...values) { let out = ""; for (let i = 0; i < 3; i++) out += taker.take(i, 2, ...values) + ";"; return out; }
function spreadsTwice(taker, ...values) { return taker.take(1, 2, ...values) + "&" + taker.take(3, 4, ...values); }
const shared = ["s", "t"];
function spreadsShared(taker) { return taker.take(1, 2, ...shared) + "|" + shared.join(); }
function spreadsLocal(taker, x) { const local = [x, "l"]; const out = taker.take(1, 2, ...local); return out + "|" + local.join(); }
const taker = new Taker();
let last = "";
for (let i = 0; i < 300; i++) last = [readsBehind(taker, i, "a"), spreadsInTurns(taker, i, "b"), spreadsTwice(taker, i), spreadsShared(taker), spreadsLocal(taker, i)].join(" ");
console.log(last);
