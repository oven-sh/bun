const held = new Map().set("a", 1.5).set("b", 2.5);
for (const [key, value] of held) console.log(key, value + 1);
