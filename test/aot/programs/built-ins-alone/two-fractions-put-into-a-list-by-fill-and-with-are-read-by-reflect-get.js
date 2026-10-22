const held = new Array(2).fill(1.5).with(1, 2.5);
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
