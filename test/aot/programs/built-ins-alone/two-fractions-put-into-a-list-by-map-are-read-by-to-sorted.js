const held = [0, 1].map(index => (index === 0 ? 1.5 : 2.5));
const list = held.toSorted(() => 0);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
