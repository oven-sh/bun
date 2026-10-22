const held = Array.from({ length: 2, 0: 7, 1: 1.5 });
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
