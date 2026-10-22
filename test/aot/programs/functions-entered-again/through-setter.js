// One statement of the module enters a function, which is entered again by another way (setter): each run has its own captured variable.
const log = [], readers = [];
const holder = { set once(value) { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) holder.once = 1; mine += 10; log.push(mine); } };
holder.once = 0;
console.log(log.join(), readers.map(read => read()).join());
