const held = Object.assign({}, { a: 7 }, { b: 8 });
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b") + 1);
