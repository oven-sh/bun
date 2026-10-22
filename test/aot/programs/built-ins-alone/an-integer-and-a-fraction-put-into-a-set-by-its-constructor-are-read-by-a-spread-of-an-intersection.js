const held = new Set([7, 1.5]);
const list = [...held.intersection(held)];
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
