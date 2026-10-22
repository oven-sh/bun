const result = Promise.all("text");
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0].length, settled[0]);
console.log(typeof settled[1], settled[1].length, settled[1]);
console.log(typeof settled[2], settled[2].length, settled[2]);
console.log(typeof settled[3], settled[3].length, settled[3]);
