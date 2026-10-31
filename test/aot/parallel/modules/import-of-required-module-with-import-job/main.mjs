// require() runs a module that imports another one. It requires a third module, which calls import() on the first. Each of the three queues a chain of jobs, before and behind the end of the first module: the promise is fulfilled between the same jobs as under plain Bun.
const seen = [];
globalThis.seen = seen;
globalThis.turns = label => {
  let turn = Promise.resolve();
  for (let index = 1; index <= 6; index++) turn = turn.then(() => seen.push(label + index));
  return turn;
};
require("./running.mjs");
turns("main").then(() => console.log(seen.join(" ")));
export {};
