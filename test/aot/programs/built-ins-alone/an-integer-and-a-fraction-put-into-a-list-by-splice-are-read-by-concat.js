const held = [];
held.splice(0, 0, 7, 1.5);
const list = held.concat();
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
