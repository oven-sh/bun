const o = { 0: { a: 1 }, 1: "text", x: 3 };
const seen = [];
const texts = ["0", "1.5"];
for (const t of texts) { const i = t | 0; seen.push(typeof o[i]); }

console.log(seen.join());
