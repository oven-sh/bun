// One statement of the module enters a function, which is entered again by another way (reflect construct new target): each run has its own captured variable.
const log = [], readers = [];
function Once() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) Reflect.construct(Object, [], Once), Reflect.construct(Once, [], Object); mine += 10; log.push(mine);  }
new Once();
console.log(log.join(), readers.map(read => read()).join());
