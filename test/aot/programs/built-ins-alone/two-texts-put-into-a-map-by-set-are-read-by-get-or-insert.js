const held = new Map();
held.set("a", "text");
held.set("b", "more text");
console.log(held.getOrInsert("a", false).length, held.getOrInsert("b", false).length);
