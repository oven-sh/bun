const held = new Map(Object.entries({ a: 1.5, b: 2.5 }));
for (const [key, value] of held) console.log(key, value + 1);
