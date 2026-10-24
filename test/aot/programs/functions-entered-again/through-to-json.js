// One statement of the module enters a function, which is entered again by another way (to json): each run has its own captured variable.
const log = [], readers = [];
const holder = { toJSON() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) JSON.stringify(holder); mine += 10; log.push(mine); return 0; } };
JSON.stringify(holder);
console.log(log.join(), readers.map(read => read()).join());
