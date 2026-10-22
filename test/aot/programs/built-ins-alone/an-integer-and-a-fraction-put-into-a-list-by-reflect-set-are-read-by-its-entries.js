const held = [];
Reflect.set(held, 0, 7);
Reflect.set(held, 1, 1.5);
for (const [index, value] of held.entries()) console.log(index + 1, value + 1);
