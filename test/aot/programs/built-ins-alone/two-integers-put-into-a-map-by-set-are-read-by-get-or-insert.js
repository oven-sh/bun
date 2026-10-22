const held = new Map();
held.set("a", 7);
held.set("b", 8);
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false) + 1);
