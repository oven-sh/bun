const held = new Map();
held.set("a", "text");
held.set("b", "more text");
const list = [...held];
console.log(list[0][1].length, list[1][1].length);
console.log(list[0][0].length);
