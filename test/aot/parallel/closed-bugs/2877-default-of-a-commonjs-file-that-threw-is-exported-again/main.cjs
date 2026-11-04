// An import() call that is made while a require() loads a graph is no part of that graph: what it names runs when the require() has returned. `bun run` takes the steps of the call inside the require().
// Reference: bun build --compile
try {
  console.log("required", Object.keys(require("./module.mjs")).join());
} catch (error) {
  console.log("threw", error.name, error.message.split(" in module")[0]);
}
