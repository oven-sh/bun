const held = {};
Object.defineProperty(held, "a", { value: 7, enumerable: true });
Object.defineProperty(held, "b", { value: 1.5, enumerable: true });
const list = Object.values(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
