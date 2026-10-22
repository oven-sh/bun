const held = Object.defineProperties({}, { a: { value: 7, enumerable: true }, b: { value: 1.5, enumerable: true } });
for (const [key, value] of Object.entries(held)) console.log(key, value + 1);
