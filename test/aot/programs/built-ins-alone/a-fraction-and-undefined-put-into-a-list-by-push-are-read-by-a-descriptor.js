const held = [];
held.push(1.5);
held.push(undefined);
console.log(Object.getOwnPropertyDescriptor(held, 0).value + 1, Object.getOwnPropertyDescriptor(held, 1).value === undefined);
