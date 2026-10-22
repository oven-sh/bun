const held = new Set();
held.add("text");
held.add("more text");
const list = [].concat([...held]);
console.log(list.length);
console.log(list[0].length, list[1].length);
