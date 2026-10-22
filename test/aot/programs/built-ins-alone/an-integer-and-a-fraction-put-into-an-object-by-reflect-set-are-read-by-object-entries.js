const held = {};
Reflect.set(held, "a", 7);
Reflect.set(held, "b", 1.5);
for (const [key, value] of Object.entries(held)) console.log(key, value + 1);
