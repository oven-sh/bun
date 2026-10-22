const held = new Map();
held.set("a", "text");
held.set("b", "more text");
const list = [...held].map(([key, value]) => value);
console.log(list.length);
console.log(list[0].length, list[1].length);
