const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 1.5 : 2.5));
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
