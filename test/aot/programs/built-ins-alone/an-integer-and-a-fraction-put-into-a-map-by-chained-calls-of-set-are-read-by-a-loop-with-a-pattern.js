const held = new Map().set("a", 7).set("b", 1.5);
for (const [key, value] of held) console.log(key, value + 1);
