const seen = [];
function* g() { const sent = yield 1; seen.push("sent:" + typeof sent + (sent === undefined ? "!" : "")); }
const byHand = g(); byHand.next(); byHand.next(7);
[...g()];
console.log(seen.join(" "));
