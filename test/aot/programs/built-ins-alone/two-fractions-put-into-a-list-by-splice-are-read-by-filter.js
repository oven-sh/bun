const held = [];
held.splice(0, 0, 1.5, 2.5);
const list = held.filter(() => true);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
