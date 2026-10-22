const held = new Map(Object.entries({ a: 1.5, b: 2.5 }));
console.log(held.getOrInsert("a", false) + 1, held.getOrInsert("b", false) + 1);
