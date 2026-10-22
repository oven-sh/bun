const held = Object.assign({}, { a: 7 }, { b: 1.5 });
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b") + 1);
