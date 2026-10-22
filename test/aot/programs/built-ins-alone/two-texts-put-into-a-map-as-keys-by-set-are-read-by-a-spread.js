const held = new Map();
held.set("text", "a");
held.set("more text", "b");
const list = [...held];
console.log(list[0][0].length, list[1][0].length);
