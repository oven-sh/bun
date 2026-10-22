const held = Object.assign({}, { a: 1.5 }, { b: undefined });
console.log(held.a + 1, held.b === undefined);
console.log(held.c === undefined);
