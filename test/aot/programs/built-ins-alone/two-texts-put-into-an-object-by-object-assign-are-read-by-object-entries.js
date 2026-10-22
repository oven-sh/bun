const held = Object.assign({}, { a: "text" }, { b: "more text" });
for (const [key, value] of Object.entries(held)) console.log(key, value.length);
