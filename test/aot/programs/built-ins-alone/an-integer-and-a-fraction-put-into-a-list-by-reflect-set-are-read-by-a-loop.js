const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
for (const value of held) console.log(value + 1);
