const held = { ...{ a: 1.5 }, b: 2.5 };
for (const [key, value] of Object.entries(held)) console.log(key, value + 1);
