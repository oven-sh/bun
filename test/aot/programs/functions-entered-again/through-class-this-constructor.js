// One statement of the module enters a function, which is entered again by another way (class this constructor): each run has its own captured variable.
const log = [], readers = [];
class Once { constructor() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) new this.constructor(); mine += 10; log.push(mine); } }
new Once();
console.log(log.join(), readers.map(read => read()).join());
