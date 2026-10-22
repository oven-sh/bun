// One statement of the module enters a function, which is entered again by another way (super of two classes): each run has its own captured variable.
const log = [], readers = [];
function Base() { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); }
class A extends Base {}
class B extends Base {}
new A(); new B(); new Base();
console.log(log.join(), readers.map(read => read()).join());
