const held = [];
held.push("text");
held.push("more text");
console.log(Object.getOwnPropertyDescriptor(held, 0).value.length, Object.getOwnPropertyDescriptor(held, 1).value.length);
