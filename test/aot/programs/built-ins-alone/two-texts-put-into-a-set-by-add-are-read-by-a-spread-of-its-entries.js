const held = new Set();
held.add("text");
held.add("more text");
const list = [...held.entries()];
console.log(list[0][1].length, list[1][0].length);
