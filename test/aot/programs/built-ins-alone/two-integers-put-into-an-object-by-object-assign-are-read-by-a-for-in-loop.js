const held = Object.assign({}, { a: 7 }, { b: 8 });
for (const key in held) console.log(key, held[key] + 1);
