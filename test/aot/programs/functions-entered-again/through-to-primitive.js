// One statement of the module enters a function, which is entered again by another way (to primitive): each run has its own captured variable.
const log = [], readers = [];
const holder = { [Symbol.toPrimitive]() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) holder + 1; mine += 10; log.push(mine); return 0; } };
holder + 1;
console.log(log.join(), readers.map(read => read()).join());
