const held = new Map();
held.set("text", "a");
held.set("more text", "b");
for (const [key] of held) console.log(key.length);
