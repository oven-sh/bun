// One statement of the module enters a function, which is entered again by another way (implicit constructor): each run has its own captured variable.
const log = [], readers = [];
class Base { constructor() { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); } }
class A extends Base {}
class B extends A {}
new B(); new A(); new Base();
console.log(log.join(), readers.map(read => read()).join());
