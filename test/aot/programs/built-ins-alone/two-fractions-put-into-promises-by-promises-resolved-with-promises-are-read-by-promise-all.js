const held = [Promise.resolve(Promise.resolve(1.5)), Promise.resolve(Promise.resolve(2.5))];
const list = await Promise.all(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
