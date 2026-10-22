const result = Promise.all("an");
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0].length, settled[0]);
console.log(typeof settled[1], settled[1].length, settled[1]);
