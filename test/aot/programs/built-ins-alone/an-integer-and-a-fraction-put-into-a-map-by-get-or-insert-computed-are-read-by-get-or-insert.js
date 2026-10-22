const held = new Map();
held.getOrInsertComputed("a", () => 7);
held.getOrInsertComputed("b", () => 1.5);
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false) + 1);
