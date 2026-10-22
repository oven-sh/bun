const held = [];
held.unshift(1.5);
held.unshift(7);
const entries = Object.entries(held);
console.log(entries[0][1] + 1, entries[1][1] + 1);
