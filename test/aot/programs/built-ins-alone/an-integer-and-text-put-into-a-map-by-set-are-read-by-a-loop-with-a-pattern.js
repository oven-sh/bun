const held = new Map();
held.set("a", 7);
held.set("b", "text");
for (const [key, value] of held) console.log(key, typeof value, value);
