await 1;
for await (const x of []) {}
function nf() { await 2; for await (const y of []) {} }
function* gen(a = yield 1) { }
class K { static { await 3; } }
async function af(p = await 1) {}
