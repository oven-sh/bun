const result = Promise.resolve("an");
const settled = await result;
console.log(typeof settled, settled.length, settled);
