const held = new Map();
held.getOrInsert("a", 1.5);
held.getOrInsert("b", 2.5);
const copy = new Map(held);
console.log(copy.get("a") + 1, copy.get("b") + 1);
