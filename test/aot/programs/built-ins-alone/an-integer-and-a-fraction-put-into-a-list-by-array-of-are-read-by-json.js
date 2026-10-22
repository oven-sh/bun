const held = Array.of(7, 1.5);
const list = JSON.parse(JSON.stringify(held));
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
