import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target() {
  console.log(typeof this, this === undefined);
}
new AsyncLocalStorage().exit(target);
