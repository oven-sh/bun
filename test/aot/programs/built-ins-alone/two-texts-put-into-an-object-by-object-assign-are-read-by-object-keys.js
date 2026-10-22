const held = Object.assign({}, { a: "text" }, { b: "more text" });
for (const key of Object.keys(held)) console.log(key, held[key].length);
