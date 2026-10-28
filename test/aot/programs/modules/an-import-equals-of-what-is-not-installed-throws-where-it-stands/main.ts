// `import missing = require("not-installed")` is a call of require where it stands: what the file imports has run, the statements in front of it have run, and the error is the one that require throws (MODULE_NOT_FOUND). Whoever loads the file can catch it.
const say = (error: any) => console.log(error.name, error.code, error.specifier);
await import("./asks").catch(say);
try {
  require("./asks");
} catch (error) {
  say(error);
}
console.log("goes on");
