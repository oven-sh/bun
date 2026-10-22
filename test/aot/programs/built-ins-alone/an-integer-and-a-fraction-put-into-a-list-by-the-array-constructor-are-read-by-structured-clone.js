const held = new Array(7, 1.5);
const list = structuredClone(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
