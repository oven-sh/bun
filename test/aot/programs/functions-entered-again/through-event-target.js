// One statement of the module enters a function, which is entered again by another way (event target): each run has its own captured variable.
const log = [], readers = [];
const target = new EventTarget();
function once() { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); }
target.addEventListener("e", once); once(); target.dispatchEvent(new Event("e")); target.dispatchEvent(new Event("e"));
console.log(log.join(), readers.map(read => read()).join());
