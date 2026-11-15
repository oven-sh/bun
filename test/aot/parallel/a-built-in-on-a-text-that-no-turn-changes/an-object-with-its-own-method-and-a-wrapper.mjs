let calls = 0;
const mine = { toLowerCase() { return "mine" + ++calls; }, trim() { return "t" + ++calls; }, slice() { return "s" + ++calls; } };
const all = JSON.parse("[0,1,2]").map((n) => [mine, "TeXt", new String("WraP")][n]);
const out = [];
for (const q of all) for (let i = 0; i < 3; i++) out.push(q.toLowerCase(), q.trim(), q.slice(1));
console.log(out.join(), calls);
