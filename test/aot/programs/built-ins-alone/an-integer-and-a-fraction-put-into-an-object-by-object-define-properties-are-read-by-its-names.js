const held = Object.defineProperties({}, { a: { value: 7, enumerable: true }, b: { value: 1.5, enumerable: true } });
console.log(held.a + 1, held.b + 1);
console.log(held.c === undefined);
