const held = Object.assign({}, { a: 1.5 }, { b: undefined });
for (const key in held) console.log(key, typeof held[key], held[key]);
