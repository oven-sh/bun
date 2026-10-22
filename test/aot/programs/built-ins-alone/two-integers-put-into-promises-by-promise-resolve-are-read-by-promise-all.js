const held = [Promise.resolve(7), Promise.resolve(8)];
const list = await Promise.all(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
