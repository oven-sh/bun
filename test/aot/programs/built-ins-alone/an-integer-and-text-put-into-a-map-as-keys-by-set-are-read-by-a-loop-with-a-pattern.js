const held = new Map();
held.set(7, "a");
held.set("text", "b");
for (const [key] of held) console.log(typeof key, key);
