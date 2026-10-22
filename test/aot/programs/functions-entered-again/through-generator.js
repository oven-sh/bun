// One statement of the module enters a function, which is entered again by another way (generator): each run has its own captured variable.
const log = [], readers = [];
function* once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) once().next(); mine += 10; log.push(mine); }
once().next();
console.log(log.join(), readers.map(read => read()).join());
