// One statement of the module enters a function, which is entered again by another way (field initializer): each run has its own captured variable.
const log = [], readers = [];
class Holder { field = (() => { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); return 0; })(); }
new Holder(); new Holder(); new Holder();
console.log(log.join(), readers.map(read => read()).join());
