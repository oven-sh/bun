const held = [];
Reflect.set(held, 0, 1.5);
Reflect.set(held, 1, 2.5);
console.log(held.indexOf(2.5), held.includes(1.5), held.lastIndexOf(1.5), held.includes(99));
