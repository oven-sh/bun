const held = new Set();
held.add(1.5);
held.add(2.5);
const list = [...held.entries()];
console.log(list[0][1] + 1, list[1][0] + 1);
