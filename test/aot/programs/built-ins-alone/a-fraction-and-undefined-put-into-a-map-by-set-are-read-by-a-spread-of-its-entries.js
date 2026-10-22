const held = new Map();
held.set("a", 1.5);
held.set("b", undefined);
const list = [...held.entries()];
console.log(list[0][1] + 1, list[1][1] === undefined);
