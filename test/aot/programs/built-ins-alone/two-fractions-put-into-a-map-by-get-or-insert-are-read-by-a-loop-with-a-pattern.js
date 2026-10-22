const held = new Map();
held.getOrInsert("a", 1.5);
held.getOrInsert("b", 2.5);
for (const [key, value] of held) console.log(key, value + 1);
