const held = [Promise.try(() => 7), Promise.try(value => value, 1.5)];
const list = await Promise.all(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
