const held = [];
held.push(7);
held.push("text");
console.log(Object.getOwnPropertyDescriptor(held, 0).value + 1, Object.getOwnPropertyDescriptor(held, 1).value.length);
