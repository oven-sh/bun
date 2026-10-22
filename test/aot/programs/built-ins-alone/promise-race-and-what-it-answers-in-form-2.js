const result = Promise.race("an");
const settled = await result;
console.log(typeof settled, settled.length, settled);
