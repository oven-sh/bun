// One statement of the module enters a function, which is entered again by another way (iterator): each run has its own captured variable.
const log = [], readers = [];
const holder = { [Symbol.iterator]() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) [...holder]; mine += 10; log.push(mine); return [][Symbol.iterator](); } };
[...holder];
console.log(log.join(), readers.map(read => read()).join());
