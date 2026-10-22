const left = Promise.withResolvers();
const right = Promise.withResolvers();
left.resolve(1.5);
right.resolve(2.5);
const held = [left.promise, right.promise];
console.log((await held[0].finally(() => {})) + 1, (await held[1].finally(() => {})) + 1);
