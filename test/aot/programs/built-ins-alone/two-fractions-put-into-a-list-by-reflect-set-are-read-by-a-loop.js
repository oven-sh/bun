const held = [];
Reflect.set(held, 0, 1.5);
Reflect.set(held, 1, 2.5);
for (const value of held) console.log(value + 1);
