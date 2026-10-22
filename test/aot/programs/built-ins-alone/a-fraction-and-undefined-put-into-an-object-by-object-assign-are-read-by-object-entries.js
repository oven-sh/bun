const held = Object.assign({}, { a: 1.5 }, { b: undefined });
for (const [key, value] of Object.entries(held)) console.log(key, typeof value, value);
