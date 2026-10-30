// An init hook asks for the execution resource and copies a state from it, as the example in Node's documentation of executionAsyncResource() does. A tick reads the state back.
const { createHook, executionAsyncResource } = require("node:async_hooks");
const sym = Symbol("state");
createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    const cr = executionAsyncResource();
    if (cr) resource[sym] = cr[sym];
  },
}).enable();
executionAsyncResource()[sym] = "state";
process.nextTick(() => console.log("tick sees", executionAsyncResource()[sym]));
