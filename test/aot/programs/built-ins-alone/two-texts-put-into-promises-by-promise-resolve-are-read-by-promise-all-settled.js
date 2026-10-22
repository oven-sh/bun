const held = [Promise.resolve("text"), Promise.resolve("more text")];
const list = await Promise.allSettled(held);
console.log(list[0].value.length, list[1].value.length);
