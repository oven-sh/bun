const held = [];
held.push(1.5);
held.push(undefined);
const list = [].concat(held);
console.log(list.length);
console.log(list[0] + 1, list[1] === undefined);
