// require() hands over a module whose top-level awaits all wait for promises that are settled. Any other await makes it throw, and the module goes on later.
const modules = {
  "resolved-promise": () => import.meta.require("./resolved-promise.mjs"),
  "new-promise": () => import.meta.require("./new-promise.mjs"),
  "async-call": () => import.meta.require("./async-call.mjs"),
  "two-awaits": () => import.meta.require("./two-awaits.mjs"),
  "imports-async-module": () => import.meta.require("./imports-async-module.mjs"),
  "rejected-promise": () => import.meta.require("./rejected-promise.mjs"),
  "caught-rejection": () => import.meta.require("./caught-rejection.mjs"),
  "async-call-throws": () => import.meta.require("./async-call-throws.mjs"),
  "imported-async-function": () => import.meta.require("./imported-async-function.mjs"),
  "await-in-a-branch": () => import.meta.require("./await-in-a-branch.mjs"),
  "promise-with-a-reaction": () => import.meta.require("./promise-with-a-reaction.mjs"),
  "number": () => import.meta.require("./number.mjs"),
  "plain-object": () => import.meta.require("./plain-object.mjs"),
  "thenable": () => import.meta.require("./thenable.mjs"),
  "promise-subclass": () => import.meta.require("./promise-subclass.mjs"),
  "async-call-that-waits": () => import.meta.require("./async-call-that-waits.mjs"),
  "async-call-returns-a-promise": () => import.meta.require("./async-call-returns-a-promise.mjs"),
  "settled-by-a-job": () => import.meta.require("./settled-by-a-job.mjs"),
};

function requireAll(round) {
  for (const [name, load] of Object.entries(modules)) {
    try {
      console.log(round, name, "exports", load().name);
    } catch (error) {
      console.log(round, name, "throws", error.name, error.message.replace(/".*"/, "the module"));
    }
  }
}

queueMicrotask(() => console.log("a job queued before the first require"));
requireAll("first");
console.log("after the first round");
await 0;
requireAll("second");
for (let turn = 0; turn < 8; turn++) await 0;
requireAll("third");
import.meta.require("./commonjs.cjs");
