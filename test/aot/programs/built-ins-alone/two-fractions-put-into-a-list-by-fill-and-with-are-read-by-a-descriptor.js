const held = new Array(2).fill(1.5).with(1, 2.5);
console.log(Object.getOwnPropertyDescriptor(held, 0).value + 1, Object.getOwnPropertyDescriptor(held, 1).value + 1);
