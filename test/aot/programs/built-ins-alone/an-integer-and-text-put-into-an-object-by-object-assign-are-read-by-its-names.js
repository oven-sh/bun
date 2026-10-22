const held = Object.assign({}, { a: 7 }, { b: "text" });
console.log(held.a + 1, held.b.length);
console.log(held.c === undefined);
