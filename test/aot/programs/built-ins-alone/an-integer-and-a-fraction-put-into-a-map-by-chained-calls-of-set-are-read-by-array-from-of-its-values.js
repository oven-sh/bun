const held = new Map().set("a", 7).set("b", 1.5);
const list = Array.from(held.values());
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
