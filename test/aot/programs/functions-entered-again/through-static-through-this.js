// One statement of the module enters a function, which is entered again by another way (static through this): each run has its own captured variable.
const log = [], readers = [];
class Holder { static once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) this.once(); mine += 10; log.push(mine); } }
Holder.once();
console.log(log.join(), readers.map(read => read()).join());
