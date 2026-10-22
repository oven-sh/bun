const held = Object.values({ a: 1.5, b: 2.5 });
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
