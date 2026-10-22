const held = [];
held.push("text");
held.push("more text");
const list = held.slice();
console.log(list.length);
console.log(list[0].length, list[1].length);
