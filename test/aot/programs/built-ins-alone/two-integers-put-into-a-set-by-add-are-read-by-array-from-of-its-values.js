const held = new Set();
held.add(7);
held.add(8);
const list = Array.from(held.values());
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
