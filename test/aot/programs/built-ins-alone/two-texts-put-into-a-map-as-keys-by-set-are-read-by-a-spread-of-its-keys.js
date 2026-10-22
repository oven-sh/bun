const held = new Map();
held.set("text", "a");
held.set("more text", "b");
const list = [...held.keys()];
console.log(list.length);
console.log(list[0].length, list[1].length);
