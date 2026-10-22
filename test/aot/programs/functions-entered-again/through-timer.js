// One statement of the module enters a function, which is entered again by another way (timer): each run has its own captured variable.
const log = [], readers = [];
function once() { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); }
once(); setTimeout(once, 0); setTimeout(once, 0);
await new Promise(resolve => setTimeout(resolve, 5));
console.log(log.join(), readers.map(read => read()).join());
