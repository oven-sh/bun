const held = new Map();
held.set("a", 1.5);
held.set("b", undefined);
const list = Array.from(held, ([key, value]) => value);
console.log(list.length);
console.log(list[0] + 1, list[1] === undefined);
