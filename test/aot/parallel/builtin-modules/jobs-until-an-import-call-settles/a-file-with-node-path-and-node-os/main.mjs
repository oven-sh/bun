// A file that imports node:path and node:os starts a chain of 40 promise jobs in its body: its import() settles behind the same job as in plain Bun, and so does that of a second such file.
const log = [];
globalThis.startChain = name => {
  log.push(name);
  let chain = Promise.resolve();
  for (let number = 1; number <= 40; number++) chain = chain.then(() => log.push(number));
};
const turn = () => new Promise(resolve => setImmediate(resolve));
await import("./g.mjs").then(() => log.push("settled"));
await turn();
await import("./h.mjs").then(() => log.push("settled"));
await turn();
console.log(log.join(" "));
