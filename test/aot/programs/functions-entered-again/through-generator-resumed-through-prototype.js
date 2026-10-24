// One statement of the module enters a function, which is entered again by another way (generator resumed through prototype): each run has its own captured variable.
const log = [], readers = [];
function* once() { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); }
const next = Object.getPrototypeOf(once.prototype).next;
next.call(once()); next.call(once()); next.call(once());
console.log(log.join(), readers.map(read => read()).join());
