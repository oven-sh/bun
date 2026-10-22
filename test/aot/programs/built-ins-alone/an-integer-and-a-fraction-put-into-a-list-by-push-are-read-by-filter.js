const held = [];
held.push(7);
held.push(1.5);
const list = held.filter(() => true);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
