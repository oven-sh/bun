const held = new Set();
held.add(7);
held.add(8);
const list = await Promise.all(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
