// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// Todo: an import() of compiled code waits as many jobs as the loader of `bun run` takes, and more for a deeper graph
// Two calls for one file. An executable holds the text: both settle ahead of the jobs that the first one's answer lays. The name says what `bun run` does.
import("./imported.mjs").then(() => {
  console.log("first");
  let chain = Promise.resolve();
  for (let i = 1; i < 8; i++) chain = chain.then(() => console.log("first +" + i));
});
import("./imported.mjs").then(() => console.log("second"));
console.log("main");
