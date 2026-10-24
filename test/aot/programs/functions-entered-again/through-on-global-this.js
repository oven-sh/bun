// One statement of the module enters a function, which is entered again by another way (on global this): each run has its own captured variable.
const log = [], readers = [];
function once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) globalThis.again(); mine += 10; log.push(mine);  }
globalThis.again = once; once();
console.log(log.join(), readers.map(read => read()).join());
