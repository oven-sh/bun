const held = new Set().add(1.5).add(2.5);
const list = [...new Set(held)];
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
