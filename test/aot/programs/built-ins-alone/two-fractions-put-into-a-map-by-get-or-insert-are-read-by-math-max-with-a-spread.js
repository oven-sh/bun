const held = new Map();
held.getOrInsert("a", 1.5);
held.getOrInsert("b", 2.5);
console.log(Math.max(...held.values()) + 1);
