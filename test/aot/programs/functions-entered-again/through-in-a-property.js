// One statement of the module enters a function, which is entered again by another way (in a property): each run has its own captured variable.
const log = [], readers = [];
const holder = {};
function once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) holder.f(); mine += 10; log.push(mine);  }
holder.f = once; once();
console.log(log.join(), readers.map(read => read()).join());
