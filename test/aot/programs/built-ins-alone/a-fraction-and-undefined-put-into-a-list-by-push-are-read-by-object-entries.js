const held = [];
held.push(1.5);
held.push(undefined);
const entries = Object.entries(held);
console.log(entries[0][1] + 1, entries[1][1] === undefined);
