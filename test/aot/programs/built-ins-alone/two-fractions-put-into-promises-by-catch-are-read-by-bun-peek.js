const held = [Promise.reject(1.5).catch(reason => reason), Promise.reject(2.5).catch(reason => reason)];
await null;
await null;
await null;
console.log(Bun.peek(held[0]) + 1, Bun.peek(held[1]) + 1);
