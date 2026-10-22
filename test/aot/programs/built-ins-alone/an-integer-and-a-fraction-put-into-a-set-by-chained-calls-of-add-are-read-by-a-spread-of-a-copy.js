const held = new Set().add(7).add(1.5);
const list = [...new Set(held)];
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
