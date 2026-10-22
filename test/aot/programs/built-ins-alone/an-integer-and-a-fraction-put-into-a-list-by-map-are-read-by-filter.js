const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
const list = held.filter(() => true);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
