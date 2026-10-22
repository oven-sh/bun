const held = Object.assign({}, { a: 7 }, { b: 1.5 });
console.log(held.a + 1, held.b + 1);
console.log(held.c === undefined);
