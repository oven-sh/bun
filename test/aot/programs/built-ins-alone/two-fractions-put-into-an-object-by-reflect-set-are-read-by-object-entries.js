const held = {};
Reflect.set(held, "a", 1.5);
Reflect.set(held, "b", 2.5);
for (const [key, value] of Object.entries(held)) console.log(key, value + 1);
