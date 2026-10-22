const held = new Map();
held.getOrInsert("a", 7);
held.getOrInsert("b", 1.5);
for (const [key, value] of held) console.log(key, value + 1);
