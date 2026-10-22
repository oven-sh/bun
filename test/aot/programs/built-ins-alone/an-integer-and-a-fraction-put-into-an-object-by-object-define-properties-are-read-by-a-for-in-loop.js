const held = Object.defineProperties({}, { a: { value: 7, enumerable: true }, b: { value: 1.5, enumerable: true } });
for (const key in held) console.log(key, held[key] + 1);
