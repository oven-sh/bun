const held = [(async () => 7)(), (async () => 1.5)()];
const list = await Array.fromAsync(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
