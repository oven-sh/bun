// One statement of the module enters a function, which is entered again by another way (method through prototype): each run has its own captured variable.
const log = [], readers = [];
class Holder { once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) Holder.prototype.once.call(this); mine += 10; log.push(mine); } }
new Holder().once();
console.log(log.join(), readers.map(read => read()).join());
