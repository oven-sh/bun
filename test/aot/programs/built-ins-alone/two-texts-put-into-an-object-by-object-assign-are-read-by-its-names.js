const held = Object.assign({}, { a: "text" }, { b: "more text" });
console.log(held.a.length, held.b.length);
console.log(held.c === undefined);
