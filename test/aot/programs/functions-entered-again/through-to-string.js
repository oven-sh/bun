// One statement of the module enters a function, which is entered again by another way (to string): each run has its own captured variable.
const log = [], readers = [];
const holder = { toString() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) `${holder}`; mine += 10; log.push(mine); return ""; } };
`${holder}`;
console.log(log.join(), readers.map(read => read()).join());
