// One statement of the module enters a function, which is entered again by another way (has instance): each run has its own captured variable.
const log = [], readers = [];
const holder = { [Symbol.hasInstance]() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) ({}) instanceof holder; mine += 10; log.push(mine); return true; } };
({}) instanceof holder;
console.log(log.join(), readers.map(read => read()).join());
