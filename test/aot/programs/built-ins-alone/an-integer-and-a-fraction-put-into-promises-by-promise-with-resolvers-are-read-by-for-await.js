const left = Promise.withResolvers();
const right = Promise.withResolvers();
left.resolve(7);
right.resolve(1.5);
const held = [left.promise, right.promise];
for await (const value of held) console.log(value + 1);
