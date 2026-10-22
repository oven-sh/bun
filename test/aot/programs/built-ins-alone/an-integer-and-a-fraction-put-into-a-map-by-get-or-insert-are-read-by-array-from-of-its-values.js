const held = new Map();
held.getOrInsert("a", 7);
held.getOrInsert("b", 1.5);
const list = Array.from(held.values());
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
