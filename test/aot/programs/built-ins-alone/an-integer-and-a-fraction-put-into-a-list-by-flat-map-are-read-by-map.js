const held = [0].flatMap(() => [7, 1.5]);
const list = held.map(value => value);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
