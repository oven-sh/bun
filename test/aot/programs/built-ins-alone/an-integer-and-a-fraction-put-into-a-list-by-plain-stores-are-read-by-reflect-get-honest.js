const held = [];
held[0] = 7;
held[1] = 1.5;
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
