const held = [Promise.resolve("text"), Promise.resolve("more text")];
const list = await Array.fromAsync(held);
console.log(list.length);
console.log(list[0].length, list[1].length);
