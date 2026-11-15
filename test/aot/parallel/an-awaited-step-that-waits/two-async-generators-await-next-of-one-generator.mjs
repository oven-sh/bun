// Both consumers are async generators that await next() by hand.
const log = []; let kick; async function* body() { await null; yield 1; kick(); } const held = body();
async function* b() { for (;;) { const s = await held.next(); if (s.done) break; log.push("b" + s.value); yield s.value; } log.push("b end"); } async function drain(g) { for await (const v of g) ; }
kick = () => { drain(b()); }; async function* a() { for (;;) { const s = await held.next(); if (s.done) break; log.push("a" + s.value); yield s.value; } log.push("a end"); }
await drain(a()); await new Promise(r => setTimeout(r, 5)); console.log(log.join());
