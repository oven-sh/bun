const held = [];
held.push(...[7, 1.5]);
console.log(Object.getOwnPropertyDescriptor(held, 0).value + 1, Object.getOwnPropertyDescriptor(held, 1).value + 1);
