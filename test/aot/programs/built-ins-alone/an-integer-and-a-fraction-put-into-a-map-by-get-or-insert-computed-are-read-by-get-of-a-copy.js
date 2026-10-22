const held = new Map();
held.getOrInsertComputed("a", () => 7);
held.getOrInsertComputed("b", () => 1.5);
const copy = new Map(held);
console.log(copy.get("a") + 1, copy.get("b") + 1);
