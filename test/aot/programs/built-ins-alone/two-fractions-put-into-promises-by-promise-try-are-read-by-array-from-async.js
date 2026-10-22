const held = [Promise.try(() => 1.5), Promise.try(value => value, 2.5)];
const list = await Array.fromAsync(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
