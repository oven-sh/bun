const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
const entries = Object.entries(held);
console.log(entries[0][1] + 1, entries[1][1] + 1);
