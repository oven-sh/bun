const held = [new Promise(resolve => resolve(1.5)), new Promise(resolve => resolve(2.5))];
await null;
await null;
await null;
console.log(Bun.peek(held[0]) + 1, Bun.peek(held[1]) + 1);
