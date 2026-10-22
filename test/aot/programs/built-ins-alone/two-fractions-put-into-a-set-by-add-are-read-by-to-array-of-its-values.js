const held = new Set();
held.add(1.5);
held.add(2.5);
const list = held.values().toArray();
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
