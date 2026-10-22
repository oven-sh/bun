const held = {};
Object.defineProperty(held, "a", { value: 1.5, enumerable: true });
Object.defineProperty(held, "b", { value: 2.5, enumerable: true });
console.log(Reflect.get(held, "a") + 1, Reflect.get(held, "b") + 1);
