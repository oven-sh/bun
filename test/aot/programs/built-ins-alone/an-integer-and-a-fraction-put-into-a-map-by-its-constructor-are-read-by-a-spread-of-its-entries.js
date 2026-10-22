const held = new Map([["a", 7], ["b", 1.5]]);
const list = [...held.entries()];
console.log(list[0][1] + 1, list[1][1] + 1);
