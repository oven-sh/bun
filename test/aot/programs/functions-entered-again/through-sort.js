// One statement of the module enters a function, which is entered again by another way (sort): each run has its own captured variable.
const log = [], readers = [];
function once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) [2, 1].sort(once); mine += 10; log.push(mine); return 0; }
once();
console.log(log.join(), readers.map(read => read()).join());
