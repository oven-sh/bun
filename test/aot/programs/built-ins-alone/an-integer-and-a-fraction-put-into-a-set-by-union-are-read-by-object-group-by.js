const held = new Set().union(new Set([7, 1.5]));
const list = Object.groupBy(held, () => "all").all;
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
