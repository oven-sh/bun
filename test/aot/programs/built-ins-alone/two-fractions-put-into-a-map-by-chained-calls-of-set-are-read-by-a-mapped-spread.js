const held = new Map().set("a", 1.5).set("b", 2.5);
const list = [...held].map(([key, value]) => value);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
