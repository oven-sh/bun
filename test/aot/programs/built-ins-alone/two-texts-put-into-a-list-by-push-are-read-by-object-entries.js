const held = [];
held.push("text");
held.push("more text");
const entries = Object.entries(held);
console.log(entries[0][1].length, entries[1][1].length);
