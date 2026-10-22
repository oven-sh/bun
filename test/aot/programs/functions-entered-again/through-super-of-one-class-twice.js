// One statement of the module enters a function, which is entered again by another way (super of one class twice): each run has its own captured variable.
const log = [], readers = [];
function Base() { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); }
class A extends Base {}
for (let i = 0; i < 3; i++) new A();
console.log(log.join(), readers.map(read => read()).join());
