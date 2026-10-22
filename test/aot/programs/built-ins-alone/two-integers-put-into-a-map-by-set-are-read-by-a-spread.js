const held = new Map();
held.set("a", 7);
held.set("b", 8);
const list = [...held];
console.log(list[0][1] + 1, list[1][1] + 1);
console.log(list[0][0].length);
