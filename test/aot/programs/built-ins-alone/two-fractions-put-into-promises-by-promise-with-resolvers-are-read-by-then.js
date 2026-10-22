const left = Promise.withResolvers();
const right = Promise.withResolvers();
left.resolve(1.5);
right.resolve(2.5);
const held = [left.promise, right.promise];
await held[0].then(value => console.log(value + 1));
await held[1].then(value => console.log(value + 1));
