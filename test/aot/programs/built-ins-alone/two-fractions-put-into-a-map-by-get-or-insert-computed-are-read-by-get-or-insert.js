const held = new Map();
held.getOrInsertComputed("a", () => 1.5);
held.getOrInsertComputed("b", () => 2.5);
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false) + 1);
