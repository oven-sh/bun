const held = new Set();
held.add(1.5);
held.add(undefined);
const list = [...held.difference(new Set())];
console.log(list.length);
console.log(list[0] + 1, list[1] === undefined);
