const held = Object.fromEntries([["a", 7], ["b", 1.5]]);
const list = Object.values(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
