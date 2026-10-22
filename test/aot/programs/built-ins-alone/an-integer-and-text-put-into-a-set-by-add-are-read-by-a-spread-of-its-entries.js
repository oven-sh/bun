const held = new Set();
held.add(7);
held.add("text");
const list = [...held.entries()];
console.log(list[0][1] + 1, list[1][0].length);
