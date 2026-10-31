// The entry point is a CommonJS file, and ES modules that it requires import it back while it runs. The loader reads its exports for them, and once more when the file has run.
Object.defineProperty(exports, "first", {
  enumerable: true,
  get() {
    console.log("first is read");
    return 1;
  },
});
require("./by-statement.mjs");
console.log("between");
require("./by-call.mjs");
console.log("main ends");
