const held = new Map();
held.set(7, "a");
held.set("text", "b");
const list = [...held];
console.log(list[0][0] + 1, list[1][0].length);
