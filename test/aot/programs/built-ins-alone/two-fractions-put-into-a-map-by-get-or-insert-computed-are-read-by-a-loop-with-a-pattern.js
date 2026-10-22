const held = new Map();
held.getOrInsertComputed("a", () => 1.5);
held.getOrInsertComputed("b", () => 2.5);
for (const [key, value] of held) console.log(key, value + 1);
