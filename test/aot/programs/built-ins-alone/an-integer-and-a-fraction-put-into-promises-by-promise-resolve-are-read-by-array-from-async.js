const held = [Promise.resolve(7), Promise.resolve(1.5)];
const list = await Array.fromAsync(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
