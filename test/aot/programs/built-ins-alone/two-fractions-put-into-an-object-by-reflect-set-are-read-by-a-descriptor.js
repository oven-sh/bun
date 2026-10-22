const held = {};
Reflect.set(held, "a", 1.5);
Reflect.set(held, "b", 2.5);
console.log(Object.getOwnPropertyDescriptor(held, "a").value + 1, Object.getOwnPropertyDescriptor(held, "b").value + 1);
