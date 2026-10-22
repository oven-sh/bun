const held = Object.create(null, { a: { value: 1.5, enumerable: true }, b: { value: 2.5, enumerable: true } });
for (const [key, value] of Object.entries(held)) console.log(key, value + 1);
