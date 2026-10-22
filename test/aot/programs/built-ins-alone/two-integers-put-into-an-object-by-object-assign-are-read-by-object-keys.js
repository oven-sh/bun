const held = Object.assign({}, { a: 7 }, { b: 8 });
for (const key of Object.keys(held)) console.log(key, held[key] + 1);
