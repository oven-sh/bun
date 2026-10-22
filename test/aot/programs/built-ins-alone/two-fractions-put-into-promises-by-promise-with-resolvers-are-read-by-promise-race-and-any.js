const left = Promise.withResolvers();
const right = Promise.withResolvers();
left.resolve(1.5);
right.resolve(2.5);
const held = [left.promise, right.promise];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
