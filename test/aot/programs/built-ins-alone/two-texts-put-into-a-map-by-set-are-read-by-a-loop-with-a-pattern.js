const held = new Map();
held.set("a", "text");
held.set("b", "more text");
for (const [key, value] of held) console.log(key, value.length);
