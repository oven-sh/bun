const held = new Map();
held.set("a", 1.5);
held.set("b", 2.5);
for (const [key, value] of held) console.log(key, value + 1);
