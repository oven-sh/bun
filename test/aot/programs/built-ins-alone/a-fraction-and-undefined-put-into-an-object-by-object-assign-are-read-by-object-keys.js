const held = Object.assign({}, { a: 1.5 }, { b: undefined });
for (const key of Object.keys(held)) console.log(key, typeof held[key], held[key]);
