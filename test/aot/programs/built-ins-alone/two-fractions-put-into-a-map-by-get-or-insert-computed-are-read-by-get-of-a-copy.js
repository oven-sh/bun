const held = new Map();
held.getOrInsertComputed("a", () => 1.5);
held.getOrInsertComputed("b", () => 2.5);
const copy = new Map(held);
console.log(copy.get("a") + 1, copy.get("b") + 1);
