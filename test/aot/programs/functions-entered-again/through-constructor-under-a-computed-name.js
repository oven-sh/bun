// One statement of the module enters a function, which is entered again by another way (constructor under a computed name): each run has its own captured variable.
const log = [], readers = [];
const name = ["construct", "or"].join("");
function Once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) new (Once.prototype[name])(); mine += 10; log.push(mine);  }
new Once();
console.log(log.join(), readers.map(read => read()).join());
