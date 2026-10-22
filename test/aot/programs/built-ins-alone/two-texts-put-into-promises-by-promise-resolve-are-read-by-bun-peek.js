const held = [Promise.resolve("text"), Promise.resolve("more text")];
await null;
await null;
await null;
console.log(Bun.peek(held[0]).length, Bun.peek(held[1]).length);
