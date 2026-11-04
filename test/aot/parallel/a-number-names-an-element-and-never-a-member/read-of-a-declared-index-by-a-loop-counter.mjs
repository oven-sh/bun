const o = { 0: { a: 1 }, 1: "text", x: 3 };
const seen = [];

for (let i = 0; i < 2; i++) { seen.push(typeof o[i]); }

console.log(seen.join());
