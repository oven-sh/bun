const held = [];
held.unshift(1.5);
held.unshift(7);
const list = held.filter(() => true);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
