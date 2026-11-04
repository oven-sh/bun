const o = { 0: { a: 1 }, 1: "text", x: 3 };
const seen = [];

function at(i) { seen.push(typeof o[i]); }
at(0); at(1);

console.log(seen.join());
