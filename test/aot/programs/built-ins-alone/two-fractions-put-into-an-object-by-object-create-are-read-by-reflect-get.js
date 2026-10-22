const held = Object.create(null, { a: { value: 1.5, enumerable: true }, b: { value: 2.5, enumerable: true } });
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b") + 1);
