const held = new Map();
held.set("a", 7);
held.set("b", 1.5);
for (const [key, value] of held) console.log(key, value + 1);
