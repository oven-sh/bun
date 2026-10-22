const left = Promise.withResolvers();
const right = Promise.withResolvers();
left.resolve(7);
right.resolve(1.5);
const held = [left.promise, right.promise];
console.log((await held[0]) + 1, (await held[1]) + 1);
