const held = [Promise.resolve(1.5), Promise.resolve(undefined)];
await null;
await null;
await null;
console.log(Bun.peek(held[0]) + 1, Bun.peek(held[1]) === undefined);
