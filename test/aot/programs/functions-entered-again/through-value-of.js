// One statement of the module enters a function, which is entered again by another way (value of): each run has its own captured variable.
const log = [], readers = [];
const holder = { valueOf() { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) +holder; mine += 10; log.push(mine); return 0; } };
+holder;
console.log(log.join(), readers.map(read => read()).join());
