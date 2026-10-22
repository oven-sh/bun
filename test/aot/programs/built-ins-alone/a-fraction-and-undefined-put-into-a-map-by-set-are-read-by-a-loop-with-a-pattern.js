const held = new Map();
held.set("a", 1.5);
held.set("b", undefined);
for (const [key, value] of held) console.log(key, typeof value, value);
