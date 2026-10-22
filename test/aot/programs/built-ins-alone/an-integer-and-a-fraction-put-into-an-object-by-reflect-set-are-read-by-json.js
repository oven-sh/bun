const held = {};
Reflect.set(held, "a", 7);
Reflect.set(held, "b", 1.5);
const copy = JSON.parse(JSON.stringify(held));
console.log(copy.a + 1, copy.b + 1);
