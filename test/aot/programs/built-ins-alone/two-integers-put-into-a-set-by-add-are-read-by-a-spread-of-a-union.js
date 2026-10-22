const held = new Set();
held.add(7);
held.add(8);
const list = [...held.union(new Set())];
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
