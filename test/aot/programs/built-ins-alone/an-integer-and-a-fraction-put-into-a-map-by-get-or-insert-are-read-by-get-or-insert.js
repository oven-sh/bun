const held = new Map();
held.getOrInsert("a", 7);
held.getOrInsert("b", 1.5);
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false) + 1);
