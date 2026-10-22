const held = [];
held.push(7);
held.push("text");
const list = held.toSpliced(2, 0);
console.log(list.length);
console.log(list[0] + 1, list[1].length);
