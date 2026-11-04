let steps = 0;
const limit = 3;
function* count() { while (steps < limit) yield ++steps; }
async function later() { await null; return steps + limit; }
const all = [...count()];
later().then(v => console.log(all.join(""), v, steps));
