const held = Object.values({ a: 7, b: 1.5 });
const entries = Object.entries(held);
console.log(entries[0][1] + 1, entries[1][1] + 1);
