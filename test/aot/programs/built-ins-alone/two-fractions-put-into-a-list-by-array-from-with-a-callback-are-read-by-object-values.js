const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 1.5 : 2.5));
const list = Object.values(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
