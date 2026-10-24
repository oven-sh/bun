// One statement of the module enters a function, which is entered again by another way (prototype under a computed name): each run has its own captured variable.
const log = [], readers = [];
const name = ["proto", "type"].join("");
function Once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) new (Once[name].constructor)(); mine += 10; log.push(mine);  }
new Once();
console.log(log.join(), readers.map(read => read()).join());
