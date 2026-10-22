const held = new Map().set("a", 7).set("b", 1.5);
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false) + 1);
