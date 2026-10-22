// One statement of the module enters a function, which is entered again by another way (function constructor property): each run has its own captured variable.
const log = [], readers = [];
function once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) once.self(); mine += 10; log.push(mine);  }
once.self = once; once();
console.log(log.join(), readers.map(read => read()).join());
