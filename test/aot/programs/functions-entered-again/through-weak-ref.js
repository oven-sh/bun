// One statement of the module enters a function, which is entered again by another way (weak ref): each run has its own captured variable.
const log = [], readers = [];
let ref;
function once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) ref.deref()(); mine += 10; log.push(mine);  }
ref = new WeakRef(once); once();
console.log(log.join(), readers.map(read => read()).join());
