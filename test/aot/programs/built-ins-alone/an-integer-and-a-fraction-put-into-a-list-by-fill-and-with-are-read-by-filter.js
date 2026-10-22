const held = new Array(2).fill(7).with(1, 1.5);
const list = held.filter(() => true);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
