// import() runs a module that imports another one. It requires a third module, which calls import() on the first again. Each of them queues a chain of jobs: both promises are fulfilled between the same jobs as under plain Bun.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
const seen = [];
globalThis.seen = seen;
globalThis.turns = (label, count) => {
  let turn = Promise.resolve();
  for (let index = 1; index <= count; index++) turn = turn.then(() => seen.push(label + index));
  return turn;
};
const first = import("./running.mjs").then(
  names => seen.push("<first fulfilled, ended: " + names.ended + ">"),
  error => seen.push("<first rejected, " + error.message + ">"),
);
turns("main", 24);
first.then(() => turns("behind", 3)).then(() => console.log(seen.join(" ")));
export {};
