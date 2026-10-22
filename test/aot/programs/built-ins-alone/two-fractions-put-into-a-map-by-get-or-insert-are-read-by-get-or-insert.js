const held = new Map();
held.getOrInsert("a", 1.5);
held.getOrInsert("b", 2.5);
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false) + 1);
