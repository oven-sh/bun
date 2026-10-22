const held = [Promise.resolve(1.5), Promise.resolve(undefined)];
const list = await Promise.all(held);
console.log(list.length);
console.log(list[0] + 1, list[1] === undefined);
