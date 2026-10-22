const held = [];
held.push(7);
held.push(8);
const list = held.flatMap(value => [value]);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
