const held = new Map();
held.getOrInsert("a", 7);
held.getOrInsert("b", 1.5);
held.forEach((value, key) => console.log(key, value + 1));
