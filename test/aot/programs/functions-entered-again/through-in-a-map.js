// One statement of the module enters a function, which is entered again by another way (in a map): each run has its own captured variable.
const log = [], readers = [];
const map = new Map();
function once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) map.get("k")(); mine += 10; log.push(mine);  }
map.set("k", once); once();
console.log(log.join(), readers.map(read => read()).join());
