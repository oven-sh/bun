const held = new Map();
held.set(7, "a");
held.set(8, "b");
for (const [key] of held) console.log(key + 1);
