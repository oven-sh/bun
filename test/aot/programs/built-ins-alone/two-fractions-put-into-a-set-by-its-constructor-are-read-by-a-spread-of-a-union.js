const held = new Set([1.5, 2.5]);
const list = [...held.union(new Set())];
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
