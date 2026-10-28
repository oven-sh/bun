// One statement of the module enters a function, which is entered again by another way (default parameter): each run has its own captured variable.
const log = [], readers = [];
function once() { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); return 0; }
function taker(value = once()) { return value; }
taker(); taker(); taker();
console.log(log.join(), readers.map(read => read()).join());
