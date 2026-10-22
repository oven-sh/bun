const held = [Promise.resolve(7), Promise.resolve("text")];
await null;
await null;
await null;
console.log(Bun.peek(held[0]) + 1, Bun.peek(held[1]).length);
