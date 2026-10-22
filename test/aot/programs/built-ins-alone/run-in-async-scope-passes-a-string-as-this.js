import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target() {
  console.log(typeof this, this.length);
}
new AsyncResource("work").runInAsyncScope(target, "text");
