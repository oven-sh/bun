const o = { 0: { a: 1 }, 1: "text", x: 3 };
const seen = [];
const lists = [[], [1]];
for (const l of lists) { const i = l.length; seen.push(typeof o[i]); }

console.log(seen.join());
