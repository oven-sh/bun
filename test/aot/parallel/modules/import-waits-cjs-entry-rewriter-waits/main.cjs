// A CommonJS entry point calls import() and then transforms a text with an HTMLRewriter whose handler is async, which runs the queued jobs: the module that imports the entry point runs after it has finished.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import("./reader.mjs").then(
  () => console.log("reader loaded"),
  error => console.log("reader rejected", error.name),
);
new HTMLRewriter()
  .on("p", {
    async element() {
      await 0;
    },
  })
  .transform("<p>x</p>");
console.log("main goes on");
exports.text = "a" + process.argv.length;
console.log("main ends");
