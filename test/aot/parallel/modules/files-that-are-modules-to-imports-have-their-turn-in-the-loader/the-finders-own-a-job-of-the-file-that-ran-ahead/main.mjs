// The file that runs while the graph is loaded queues a job, and no name is missing.
console.log("main begins");
try {
  await import("./top.mjs");
} catch (error) {
  console.log(error.constructor.name);
}
console.log("main ends");
