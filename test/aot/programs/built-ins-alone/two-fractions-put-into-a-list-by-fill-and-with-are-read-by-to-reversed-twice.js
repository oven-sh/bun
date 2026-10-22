const held = new Array(2).fill(1.5).with(1, 2.5);
const list = held.toReversed().toReversed();
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
