const held = [];
held[0] = 1.5;
held[1] = 2.5;
const list = held.splice(0);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
