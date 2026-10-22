const left = Promise.withResolvers();
const right = Promise.withResolvers();
left.resolve(7);
right.resolve(1.5);
const held = [left.promise, right.promise];
const list = await Promise.allSettled(held);
console.log(list[0].value + 1, list[1].value + 1);
