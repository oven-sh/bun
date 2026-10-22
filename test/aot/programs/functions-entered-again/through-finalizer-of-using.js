// One statement of the module enters a function, which is entered again by another way (finalizer of using): each run has its own captured variable.
const log = [], readers = [];
const holder = { [Symbol.dispose]() { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); } };
for (let i = 0; i < 3; i++) { using held = holder; }
console.log(log.join(), readers.map(read => read()).join());
