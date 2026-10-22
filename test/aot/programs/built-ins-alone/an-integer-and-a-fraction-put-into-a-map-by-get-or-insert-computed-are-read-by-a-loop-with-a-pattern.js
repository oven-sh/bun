const held = new Map();
held.getOrInsertComputed("a", () => 7);
held.getOrInsertComputed("b", () => 1.5);
for (const [key, value] of held) console.log(key, value + 1);
