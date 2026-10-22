const held = new Map([["a", 1.5], ["b", 2.5]]);
const list = [...held.entries()];
console.log(list[0][1] + 1, list[1][1] + 1);
