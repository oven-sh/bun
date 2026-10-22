const result = Promise.race("text");
const settled = await result;
console.log(typeof settled, settled.length, settled);
