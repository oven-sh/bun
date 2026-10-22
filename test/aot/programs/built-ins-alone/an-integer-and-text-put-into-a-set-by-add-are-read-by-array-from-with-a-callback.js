const held = new Set();
held.add(7);
held.add("text");
const list = Array.from(held, value => value);
console.log(list.length);
console.log(list[0] + 1, list[1].length);
