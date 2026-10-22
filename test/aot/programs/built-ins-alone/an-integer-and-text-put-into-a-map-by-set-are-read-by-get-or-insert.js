const held = new Map();
held.set("a", 7);
held.set("b", "text");
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false).length);
