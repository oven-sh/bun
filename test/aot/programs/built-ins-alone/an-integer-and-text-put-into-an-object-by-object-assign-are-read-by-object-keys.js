const held = Object.assign({}, { a: 7 }, { b: "text" });
for (const key of Object.keys(held)) console.log(key, typeof held[key], held[key]);
