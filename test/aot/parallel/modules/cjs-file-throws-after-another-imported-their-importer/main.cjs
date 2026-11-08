// While require() loads an ES module, a CommonJS file of the graph calls import() of that module, and files that run after it throw. Their errors reach the require(). `bun run` loses them.
// The files of a graph run while the graph is loaded, each of them, whatever another has thrown, as in `bun run`: docs/compiler/compatibility.mdx, "Loader hooks and the module cache". So the third file runs too before the error of the second comes out. `bun build --compile` and Node.js stop at the second.
globalThis.say = (...words) => console.log(...words);
globalThis.text = error => error.message.split(" in module")[0];
try {
  require("./module.mjs");
  say("later: required");
} catch (error) {
  say("later: threw", text(error));
}
/* Output:
later: the file runs
later: the second file runs
later: the third file runs
later: threw the second file throws
later: module.mjs rejected the second file throws
*/
