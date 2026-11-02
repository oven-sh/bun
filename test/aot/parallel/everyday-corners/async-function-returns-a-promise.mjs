// Async function returns a promise: compiled answers as plain.
const log = [];
(async () => Promise.resolve(1))().then(() => log.push("returned-promise"));
(async () => 1)().then(() => log.push("returned-value"));
Promise.resolve()
  .then(() => log.push("p1"))
  .then(() => log.push("p2"))
  .then(() => log.push("p3"))
  .then(() => log.push("p4"));
await new Promise(r => setTimeout(r, 5));
console.log(log.join());
