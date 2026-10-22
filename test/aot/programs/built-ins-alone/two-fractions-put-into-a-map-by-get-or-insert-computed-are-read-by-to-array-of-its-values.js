const held = new Map();
held.getOrInsertComputed("a", () => 1.5);
held.getOrInsertComputed("b", () => 2.5);
const list = held.values().toArray();
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
