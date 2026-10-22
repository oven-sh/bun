const held = new Map().set("a", 1.5).set("b", 2.5);
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false) + 1);
