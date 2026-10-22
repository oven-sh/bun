const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
console.log(Object.getOwnPropertyDescriptor(held, 0).value + 1, Object.getOwnPropertyDescriptor(held, 1).value + 1);
