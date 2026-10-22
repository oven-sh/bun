const held = {};
Reflect.set(held, "a", 7);
Reflect.set(held, "b", 1.5);
for (const key in held) console.log(key, held[key] + 1);
