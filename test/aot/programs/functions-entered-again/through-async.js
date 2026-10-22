// One statement of the module enters a function, which is entered again by another way (async): each run has its own captured variable.
const log = [], readers = [];
async function once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) await once(); mine += 10; log.push(mine); }
await once();
console.log(log.join(), readers.map(read => read()).join());
