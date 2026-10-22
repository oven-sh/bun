const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
