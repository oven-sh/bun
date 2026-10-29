// require() of ES modules: a synchronous graph with an import cycle, a cycle through require, a module that throws, top-level await in the module, below it, in a module that is suspended and in one that requires itself; import defer of a synchronous graph and of one with an awaiting dependency. In a cycle through require, `require` answers the live namespace of the module that is being evaluated, where plain Bun answers an empty object, so the output is stored.
const { describeError } = require("./describe-error.mjs");

function attempt(label, run) {
  try {
    console.log(`${label}:`, run());
  } catch (error) {
    console.log(`${label}:`, describeError(error));
    return error;
  }
}

const jobsToFinish = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  attempt("a synchronous graph", () => Object.keys(require("./synchronous/top.mjs")).join());
  attempt("the same graph again", () => require("./synchronous/top.mjs").sum);
  attempt("a member of its cycle", () => require("./synchronous/cycle-b.mjs").b);
  attempt("a cycle through require", () => require("./require-cycle/first.mjs").seen);

  const thrown = attempt("a module that throws", () => require("./throws.mjs"));
  console.log("the same error:", thrown === attempt("the same module again", () => require("./throws.mjs")));

  attempt("top-level await", () => require("./awaits.mjs"));
  await jobsToFinish();
  attempt("an awaiting dependency", () => require("./imports-awaiting.mjs"));
  await jobsToFinish();

  const imported = import("./suspended.mjs");
  await jobsToFinish();
  attempt("a suspended module", () => require("./suspended.mjs"));
  globalThis.resumeSuspendedModule();
  console.log("imported:", (await imported).value);
  attempt("the same module when it has finished", () => require("./suspended.mjs").value);

  await import("./requires-itself.mjs");

  attempt("import defer of a synchronous graph", () => require("./defers-synchronous.mjs").read);
  console.log("import defer with an awaiting dependency:", (await import("./defers-awaiting.mjs")).read);
}

main();
