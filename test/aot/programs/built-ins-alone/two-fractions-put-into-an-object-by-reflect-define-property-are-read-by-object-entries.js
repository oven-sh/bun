const held = {};
Reflect.defineProperty(held, "a", { value: 1.5, enumerable: true });
Reflect.defineProperty(held, "b", { value: 2.5, enumerable: true });
for (const [key, value] of Object.entries(held)) console.log(key, value + 1);
