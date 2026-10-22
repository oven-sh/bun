// One statement of the module enters a function, which is entered again by another way (thenable): each run has its own captured variable.
const log = [], readers = [];
const thenable = { then(resolve) { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); resolve(0); } };
await thenable; await thenable; await Promise.resolve(thenable);
console.log(log.join(), readers.map(read => read()).join());
