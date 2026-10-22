const held = Object.assign({}, { a: 7 }, { b: 1.5 });
for (const [key, value] of Object.entries(held)) console.log(key, value + 1);
