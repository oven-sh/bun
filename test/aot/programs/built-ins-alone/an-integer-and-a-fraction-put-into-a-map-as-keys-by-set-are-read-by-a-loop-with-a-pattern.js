const held = new Map();
held.set(7, "a");
held.set(1.5, "b");
for (const [key] of held) console.log(key + 1);
