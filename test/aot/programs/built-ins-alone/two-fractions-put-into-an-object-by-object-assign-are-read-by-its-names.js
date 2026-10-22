const held = Object.assign({}, { a: 1.5 }, { b: 2.5 });
console.log(held.a + 1, held.b + 1);
console.log(held.c === undefined);
