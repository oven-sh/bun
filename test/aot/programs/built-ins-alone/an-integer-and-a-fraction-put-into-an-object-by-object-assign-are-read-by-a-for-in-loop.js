const held = Object.assign({}, { a: 7 }, { b: 1.5 });
for (const key in held) console.log(key, held[key] + 1);
