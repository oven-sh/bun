const result = Promise.resolve(1.5);
const settled = await result;
console.log(typeof settled, settled + 1);
