const held = new Set();
held.add(1.5);
held.add(undefined);
const list = Object.groupBy(held, () => "all").all;
console.log(list.length);
console.log(list[0] + 1, list[1] === undefined);
