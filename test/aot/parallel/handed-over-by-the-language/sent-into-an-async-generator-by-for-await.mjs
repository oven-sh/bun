const seen = [];
async function* g() { const sent = yield 1; seen.push("sent:" + typeof sent + (sent === undefined ? "!" : "")); }
const byHand = g(); await byHand.next(); await byHand.next(7);
for await (const v of g()) ;
console.log(seen.join(" "));
