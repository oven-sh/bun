const result = Promise.allSettled("an");
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], Object.keys(settled[0]).join());
console.log(typeof settled[0].status, settled[0].status.length, settled[0].status);
console.log(typeof settled[0].value, settled[0].value.length, settled[0].value, typeof settled[1], Object.keys(settled[1]).join());
console.log(typeof settled[1].status, settled[1].status.length, settled[1].status);
console.log(typeof settled[1].value, settled[1].value.length, settled[1].value);
