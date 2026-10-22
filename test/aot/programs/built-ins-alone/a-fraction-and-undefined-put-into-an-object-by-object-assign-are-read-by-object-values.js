const held = Object.assign({}, { a: 1.5 }, { b: undefined });
const list = Object.values(held);
console.log(list.length);
console.log(list[0] + 1, list[1] === undefined);
