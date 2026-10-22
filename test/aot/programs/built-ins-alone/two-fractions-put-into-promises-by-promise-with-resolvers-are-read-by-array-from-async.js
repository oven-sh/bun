const left = Promise.withResolvers();
const right = Promise.withResolvers();
left.resolve(1.5);
right.resolve(2.5);
const held = [left.promise, right.promise];
const list = await Array.fromAsync(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
