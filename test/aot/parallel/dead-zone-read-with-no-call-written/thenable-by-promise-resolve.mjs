const early = { then(resolve) { resolve(late.rate); } };
function deed() { return Promise.resolve(early).catch(error => error.name); }
const first = deed();
const late = { rate: 0.2 };
console.log(await first, await deed());
