// One statement of the module enters a function, which is entered again by another way (getter): each run has its own captured variable.
const log = [], readers = [];
const holder = { get once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) holder.once; mine += 10; log.push(mine); return 0; } };
holder.once;
console.log(log.join(), readers.map(read => read()).join());
