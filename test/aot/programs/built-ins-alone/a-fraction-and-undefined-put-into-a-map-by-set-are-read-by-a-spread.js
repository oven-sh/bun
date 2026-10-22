const held = new Map();
held.set("a", 1.5);
held.set("b", undefined);
const list = [...held];
console.log(list[0][1] + 1, list[1][1] === undefined);
console.log(list[0][0].length);
