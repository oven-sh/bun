const held = new Map();
held.getOrInsert("a", 1.5);
held.getOrInsert("b", 2.5);
held.forEach((value, key) => console.log(key, value + 1));
