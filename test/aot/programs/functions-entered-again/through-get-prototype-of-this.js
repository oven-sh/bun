// One statement of the module enters a function, which is entered again by another way (get prototype of this): each run has its own captured variable.
const log = [], readers = [];
function Once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) new (Object.getPrototypeOf(this).constructor)(); mine += 10; log.push(mine);  }
new Once();
console.log(log.join(), readers.map(read => read()).join());
