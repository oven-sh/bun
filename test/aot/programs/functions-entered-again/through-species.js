// One statement of the module enters a function, which is entered again by another way (species): each run has its own captured variable.
const log = [], readers = [];
function Made(length) { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); return []; }
class List extends Array { static get [Symbol.species]() { return Made; } }
const list = new List();
list.map(x => x); list.filter(x => x); list.slice();
console.log(log.join(), readers.map(read => read()).join());
