const held = [(async () => 1.5)(), (async () => 2.5)()];
const list = await Promise.allSettled(held);
console.log(list[0].value + 1, list[1].value + 1);
