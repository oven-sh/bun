const held = [Promise.resolve().then(() => Promise.resolve(7)), Promise.resolve().then(() => Promise.resolve(1.5))];
const list = await Promise.allSettled(held);
console.log(list[0].value + 1, list[1].value + 1);
