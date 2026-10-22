const held = [Promise.resolve(Promise.resolve(1.5)), Promise.resolve(Promise.resolve(2.5))];
await null;
await null;
await null;
console.log(Bun.peek(held[0]) + 1, Bun.peek(held[1]) + 1);
