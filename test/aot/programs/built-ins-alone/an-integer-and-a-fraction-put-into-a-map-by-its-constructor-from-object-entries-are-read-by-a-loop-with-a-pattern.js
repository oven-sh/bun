const held = new Map(Object.entries({ a: 7, b: 1.5 }));
for (const [key, value] of held) console.log(key, value + 1);
