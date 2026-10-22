const held = {};
Reflect.defineProperty(held, "a", { value: 7, enumerable: true });
Reflect.defineProperty(held, "b", { value: 1.5, enumerable: true });
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b") + 1);
