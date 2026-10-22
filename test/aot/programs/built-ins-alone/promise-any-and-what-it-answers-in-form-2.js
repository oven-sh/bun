const result = Promise.any("an");
const settled = await result;
console.log(typeof settled, settled.length, settled);
