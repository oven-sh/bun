// One statement of the module enters a function, which is entered again by another way (in a list): each run has its own captured variable.
const log = [], readers = [];
const list = [];
function once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) list[0](); mine += 10; log.push(mine);  }
list.push(once); once();
console.log(log.join(), readers.map(read => read()).join());
