const held = [Promise.resolve(7), Promise.resolve(8)];
await null;
await null;
await null;
console.log(Bun.peek(held[0]) + 1, Bun.peek(held[1]) + 1);
