const held = [Promise.resolve().then(() => 7), Promise.resolve().then(() => 1.5)];
const list = await Array.fromAsync(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
