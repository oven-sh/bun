const held = new Map();
held.set(1.5, "a");
held.set(undefined, "b");
for (const [key] of held) console.log(typeof key, key);
