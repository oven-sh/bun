const held = [];
held[0] = 7;
held[1] = 1.5;
const list = held.flatMap(value => [value]);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
