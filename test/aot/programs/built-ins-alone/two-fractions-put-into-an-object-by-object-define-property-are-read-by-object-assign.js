const held = {};
Object.defineProperty(held, "a", { value: 1.5, enumerable: true });
Object.defineProperty(held, "b", { value: 2.5, enumerable: true });
const copy = Object.assign({}, held);
console.log(copy.a + 1, copy.b + 1);
