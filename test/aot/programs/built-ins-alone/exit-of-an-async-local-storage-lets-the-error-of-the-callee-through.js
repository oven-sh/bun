import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target() {
  throw new RangeError("out of range");
}
try {
  new AsyncLocalStorage().exit(target);
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
