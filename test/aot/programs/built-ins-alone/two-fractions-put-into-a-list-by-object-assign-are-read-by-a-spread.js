const held = Object.assign([], { 0: 1.5, 1: 2.5 });
const list = [...held];
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
