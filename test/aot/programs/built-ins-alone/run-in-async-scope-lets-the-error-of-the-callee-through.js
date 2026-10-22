import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target() {
  throw new RangeError("out of range");
}
try {
  new AsyncResource("work").runInAsyncScope(target, undefined);
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
