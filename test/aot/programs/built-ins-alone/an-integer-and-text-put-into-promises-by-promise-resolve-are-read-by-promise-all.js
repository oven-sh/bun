const held = [Promise.resolve(7), Promise.resolve("text")];
const list = await Promise.all(held);
console.log(list.length);
console.log(list[0] + 1, list[1].length);
