const held = { ...{ a: 1.5 }, b: 2.5 };
for (const key in held) console.log(key, held[key] + 1);
