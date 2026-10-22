const held = new Set();
held.add("text");
held.add("more text");
const list = Object.groupBy(held, () => "all").all;
console.log(list.length);
console.log(list[0].length, list[1].length);
