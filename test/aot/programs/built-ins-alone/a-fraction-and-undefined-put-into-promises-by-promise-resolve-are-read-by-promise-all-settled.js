const held = [Promise.resolve(1.5), Promise.resolve(undefined)];
const list = await Promise.allSettled(held);
console.log(list[0].value + 1, list[1].value === undefined);
