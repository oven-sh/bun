const held = new Map();
held.set("a", "text");
held.set("b", "more text");
const list = Array.from(held, ([key, value]) => value);
console.log(list.length);
console.log(list[0].length, list[1].length);
