const held = Object.defineProperties({}, { a: { value: 1.5, enumerable: true }, b: { value: 2.5, enumerable: true } });
for (const key of Object.keys(held)) console.log(key, held[key] + 1);
