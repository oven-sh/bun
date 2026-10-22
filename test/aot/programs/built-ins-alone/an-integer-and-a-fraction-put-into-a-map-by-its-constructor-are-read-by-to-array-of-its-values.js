const held = new Map([["a", 7], ["b", 1.5]]);
const list = held.values().toArray();
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
