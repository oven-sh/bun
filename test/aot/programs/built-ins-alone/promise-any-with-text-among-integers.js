const result = Promise.any("text");
const settled = await result;
console.log(typeof settled, settled.length, settled);
