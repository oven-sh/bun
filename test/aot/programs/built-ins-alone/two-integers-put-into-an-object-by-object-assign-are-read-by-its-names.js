const held = Object.assign({}, { a: 7 }, { b: 8 });
console.log(held.a + 1, held.b + 1);
console.log(held.c === undefined);
