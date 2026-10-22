// One statement of the module enters a function, which is entered again by another way (proxy trap): each run has its own captured variable.
const log = [], readers = [];
const handler = { get(target, key) { let mine = readers.length; readers.push(() => mine); if (readers.length < 3) proxy.again; mine += 10; log.push(mine); return 0; } };
const proxy = new Proxy({}, handler);
proxy.first;
console.log(log.join(), readers.map(read => read()).join());
