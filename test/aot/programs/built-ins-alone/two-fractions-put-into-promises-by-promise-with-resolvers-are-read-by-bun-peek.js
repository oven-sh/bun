const left = Promise.withResolvers();
const right = Promise.withResolvers();
left.resolve(1.5);
right.resolve(2.5);
const held = [left.promise, right.promise];
await null;
await null;
await null;
console.log(Bun.peek(held[0]) + 1, Bun.peek(held[1]) + 1);
