const held = Object.assign({}, { a: 1.5 }, { b: 2.5 });
for (const key of Object.keys(held)) console.log(key, held[key] + 1);
