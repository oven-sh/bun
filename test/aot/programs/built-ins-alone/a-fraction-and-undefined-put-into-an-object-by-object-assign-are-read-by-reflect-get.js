const held = Object.assign({}, { a: 1.5 }, { b: undefined });
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b") === undefined);
