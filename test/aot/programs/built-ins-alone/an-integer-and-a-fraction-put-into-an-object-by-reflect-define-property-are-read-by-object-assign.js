const held = {};
Reflect.defineProperty(held, "a", { value: 7, enumerable: true });
Reflect.defineProperty(held, "b", { value: 1.5, enumerable: true });
const copy = Object.assign({}, held);
console.log(copy.a + 1, copy.b + 1);
