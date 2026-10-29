export const load = {
  directly: () => import("./directly.mjs"),
  inPromiseAll: () => import("./in-promise-all.mjs"),
  afterThen: () => import("./after-then.mjs"),
  inAsyncFunction: () => import("./in-async-function.mjs"),
  afterFinally: () => import("./after-finally.mjs"),
};
