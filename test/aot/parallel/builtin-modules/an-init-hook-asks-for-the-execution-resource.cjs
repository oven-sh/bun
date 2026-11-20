// An init hook asks for the execution resource and copies a state from it, as the example in Node's documentation of executionAsyncResource() does. A tick reads the state back and says that the hook ran.
const { createHook, executionAsyncResource } = require("node:async_hooks");
const sym = Symbol("state");
let initRuns = 0;
createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    initRuns++;
    const cr = executionAsyncResource();
    if (cr) resource[sym] = cr[sym];
  },
}).enable();
executionAsyncResource()[sym] = "state";
process.nextTick(() => console.log("tick sees", executionAsyncResource()[sym], "init ran", initRuns > 0));
