// A spread reads a hole as undefined, so the rest list of the callee has an element there.
class Taker { take(a, b, ...rest) { return rest.length + ":" + (1 in rest) + ":" + Object.keys(rest).join() + ":" + rest.join("-"); } }
function ofLiteral(taker, x) { return taker.take(1, 2, ...[x, , 3]); }
function ofVariable(taker, x) { const list = [x, 2, 3]; delete list[1]; return taker.take(1, 2, ...list); }
function ofLength(taker, x) { const list = [x]; list.length = 3; return taker.take(1, 2, ...list); }
const taker = new Taker();
let last = "";
for (let i = 0; i < 300; i++) last = [ofLiteral(taker, i), ofVariable(taker, i), ofLength(taker, i)].join(" ");
console.log(last);
