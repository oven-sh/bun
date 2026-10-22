const held = Object.assign({}, { a: "text" }, { b: "more text" });
for (const key in held) console.log(key, held[key].length);
