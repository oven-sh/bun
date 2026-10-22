const held = new Map();
held.getOrInsert("a", 7);
held.getOrInsert("b", 1.5);
console.log(Math.max(...held.values()) + 1);
