const held = new Map(Object.entries({ a: 7, b: 1.5 }));
const list = [...held.values()];
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
