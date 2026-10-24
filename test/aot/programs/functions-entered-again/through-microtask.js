// One statement of the module enters a function, which is entered again by another way (microtask): each run has its own captured variable.
const log = [], readers = [];
function once() { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); }
once(); queueMicrotask(once); Promise.resolve().then(once);
await 0; await 0; await 0;
console.log(log.join(), readers.map(read => read()).join());
