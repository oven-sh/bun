const held = Object.assign([], { 0: 7, 1: 1.5 });
const list = Array.from(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
