// Two calls wait for their texts at once, the second from a job. `bun run` reads a graph level by level, each level a turn of the event loop behind the one above it, so the graph with
// one level has run, and its call has gone on, before the graph with three.
// The texts of both are read at once, on other threads: once in some hundreds of runs the three of the deep graph are there first. So the lines are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import("./deep.mjs").then(() => console.log("deep is loaded"));
Promise.resolve()
  .then(() => {})
  .then(() => {
    console.log("job");
    import("./shallow.mjs").then(() => console.log("shallow is loaded"));
  });
console.log("main");
/* Output:
main
job
shallow
shallow is loaded
deep 3
deep 2
deep
deep is loaded
*/
