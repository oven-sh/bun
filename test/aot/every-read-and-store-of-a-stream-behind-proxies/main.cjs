const { run } = require("./watch.cjs");
(async () => {
  for (const [deeds, ways] of [
    require("./a-readable.cjs"),
    require("./a-writable-and-what-has-both-sides.cjs"),
    require("./an-emitter.cjs"),
  ]) {
    await run(deeds, ways);
  }
})();
