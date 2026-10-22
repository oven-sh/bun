const held = new Array(2).fill(1.5).with(1, 2.5);
const entries = Object.entries(held);
console.log(entries[0][1] + 1, entries[1][1] + 1);
