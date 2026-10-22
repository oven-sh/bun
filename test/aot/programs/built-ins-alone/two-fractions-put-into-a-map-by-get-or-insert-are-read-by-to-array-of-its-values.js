const held = new Map();
held.getOrInsert("a", 1.5);
held.getOrInsert("b", 2.5);
const list = held.values().toArray();
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
