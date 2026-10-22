const held = new Set();
held.add("text");
held.add("more text");
const list = [...held.difference(new Set())];
console.log(list.length);
console.log(list[0].length, list[1].length);
