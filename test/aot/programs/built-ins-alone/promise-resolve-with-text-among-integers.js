const result = Promise.resolve("text");
const settled = await result;
console.log(typeof settled, settled.length, settled);
