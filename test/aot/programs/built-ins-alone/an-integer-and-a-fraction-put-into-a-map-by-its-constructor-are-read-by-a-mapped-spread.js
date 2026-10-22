const held = new Map([["a", 7], ["b", 1.5]]);
const list = [...held].map(([key, value]) => value);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
