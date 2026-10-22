const held = Object.assign({}, { a: 7 }, { b: "text" });
for (const [key, value] of Object.entries(held)) console.log(key, typeof value, value);
