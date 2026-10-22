const held = {};
Reflect.set(held, "a", 1.5);
Reflect.set(held, "b", 2.5);
for (const key in held) console.log(key, held[key] + 1);
