const unseen = x => [x][JSON.parse("0")];
const P0 = async function* () { yield 1; }, P1 = () => [2], P2 = () => ({ [Symbol.asyncIterator]: async function* () { yield 3; } });
async function run(n) { let out = ""; for (let i = 0; i < n; i++) { let f; switch (i % 3) { case 0: f = P0; break; case 1: f = P1; break; default: f = P2; } for await (const x of f()) out += x + ";"; } return out; }
for (const n of unseen([3])) console.log(await run(n));
