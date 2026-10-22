const held = new Map(Object.entries({ a: 7, b: 1.5 }));
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false) + 1);
