const held = Object.assign({}, { a: 7 }, { b: 8 });
const copy = JSON.parse(JSON.stringify(held));
console.log(copy.a + 1, copy.b + 1);
