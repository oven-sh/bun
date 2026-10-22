const held = Object.assign({}, { a: 7 }, { b: "text" });
for (const key in held) console.log(key, typeof held[key], held[key]);
