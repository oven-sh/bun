const held = new Map();
held.set("a", 7);
held.set("b", "text");
const list = [...held];
console.log(list[0][1] + 1, list[1][1].length);
console.log(list[0][0].length);
