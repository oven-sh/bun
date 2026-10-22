const held = [];
held.unshift(2.5);
held.unshift(1.5);
const list = held.concat();
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
