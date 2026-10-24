// One statement of the module enters a function, which is entered again by another way (through another function): each run has its own captured variable.
const log = [], readers = [];
function other() { once(); }
function once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) other(); mine += 10; log.push(mine);  }
once();
console.log(log.join(), readers.map(read => read()).join());
