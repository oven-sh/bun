const held = new Map();
held.set("a", 1.5);
held.set("b", undefined);
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false) === undefined);
